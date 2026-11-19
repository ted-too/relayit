/**
 * A custom Domain's verification checks against a real Postgres and the real job queue: how
 * often it is checked, that one left unverified is checked less and less often and then not
 * at all, who is told, and what starts its checks again. SES and public DNS are the
 * boundaries stubbed.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { SELF_HOSTED_LIMITS } from "@repo/persistence/auth/plans";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import {
  customDomain,
  organization,
  user,
  userChannel,
  webhookEndpoint,
  webhookEvent,
} from "@repo/persistence/db/schema";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { typeid } from "typeid-js";
import { EmailBackend } from "../backend";
import { ownershipChallengeValue } from "../custom-domain/dns";
import { createCustomDomain } from "../custom-domain/lifecycle";
import { DnsLookups } from "../dns-lookups";
import { EmailManagedDns } from "../managed-dns";
import { recordedJobs } from "../recorded-jobs-test-layer";
import { verifyCustomDomainOwnership, verifyCustomDomainRegistration } from "./custom-identity";
import { emailVerifyCustomDomainHandler } from "./handlers";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;

const MINUTE = 60_000;
/** What `UNVERIFIED_DOMAIN_CHECKS` comes to: the wait after each check, then none. */
const UNVERIFIED_WAITS_IN_MINUTES = [
  2,
  4,
  8,
  16,
  32,
  64,
  128,
  256,
  512,
  ...Array.from({ length: 12 }, () => 720),
];

describe("custom Domain verification checks (PostgreSQL and Redis)", () => {
  if (!(testDatabaseUrl && testRedisUrl)) {
    process.emitWarning(
      "Skipping Domain verification tests: TEST_DATABASE_URL and TEST_REDIS_URL are not both set",
    );
    // The PostgreSQL and Redis test is opt-in.
    test.skip("custom Domain verification checks", () => undefined);
    return;
  }

  /**
   * SES and public DNS as a test sets them: `ses.verified` is what SES says of every
   * identity and `ses.whileAsked` runs while it answers, and `published` holds the record values public DNS answers with (every record
   * while `dns.allPublished`). `asked` is what SES was asked.
   */
  const boundaries = () => {
    const ses = { verified: false, whileAsked: Effect.void as Effect.Effect<void> };
    const dns = { allPublished: false };
    const published = new Set<string>();
    const asked: { readonly fqdn: string; readonly region: string | null }[] = [];
    const jobs = recordedJobs(testRedisUrl);
    const layer = Layer.mergeAll(
      Layer.succeed(EmailBackend, {
        createIdentity: ({ fqdn }) =>
          Effect.succeed({ mailFrom: { domain: `send.${fqdn}`, records: [] } }),
        defaultRegion: "eu-central-1",
        deleteIdentity: () => Effect.die("unused"),
        ensureInfrastructure: () => Effect.die("unused"),
        getIdentityStatus: (input) =>
          Effect.suspend(() => {
            asked.push(input);
            return Effect.as(ses.whileAsked, {
              dkimVerified: ses.verified,
              verified: ses.verified,
            });
          }),
        getProjectSendingStatus: () => Effect.die("unused"),
        send: () => Effect.die("unused"),
      }),
      Layer.succeed(DnsLookups, {
        detectProvider: () => Promise.resolve("cloudflare"),
        evaluate: ({ value }) =>
          Promise.resolve({ matches: dns.allPublished || published.has(value), warnings: [] }),
      }),
      jobs.layer,
      EmailManagedDns.noop(),
      SymmetricCrypto.live(parseBetterAuthSecrets("1:verification-test-secret-0123456789")),
    ).pipe(Layer.provideMerge(makeDbLive({ databaseUrl: testDatabaseUrl })));
    return {
      asked,
      dns,
      layer,
      published,
      scheduled: jobs.scheduled,
      scheduledAt: jobs.scheduledAt,
      ses,
    };
  };

  /** A Project with a Webhook Endpoint that hears `domain.updated`. */
  const insertProject = Effect.fn(function* () {
    const db = yield* DB;
    const id = typeid("orgn").toString();
    const billingUserId = `user_${id}`;
    yield* db
      .insert(user)
      .values({ email: `${billingUserId}@example.test`, id: billingUserId, name: "Billing" });
    yield* db.insert(userChannel).values({
      channelType: "email",
      limits: SELF_HOSTED_LIMITS.email,
      userId: billingUserId,
    });
    yield* db
      .insert(organization)
      .values({ billingUserId, id, name: "Domains", slug: `domains-${id}` });
    yield* db.insert(webhookEndpoint).values({
      eventTypes: ["domain.updated"],
      organizationId: id,
      signingSecret: "whsec_test",
      url: "https://hooks.relayit.test/events",
    });
    return id;
  });

  /** A Domain its Project just added: registered, and no check has run. */
  const addedDomain = Effect.fn(function* () {
    const organizationId = yield* insertProject();
    const fqdn = `${Bun.randomUUIDv7()}.example.test`;
    const { customDomainId } = yield* createCustomDomain({ fqdn, organizationId });
    return { customDomainId, fqdn, organizationId };
  });

  const domainOf = Effect.fn(function* (customDomainId: string) {
    const db = yield* DB;
    const domain = yield* db.query.customDomain.findFirst({
      where: { id: customDomainId },
      with: { organizations: true, registration: true },
    });
    return domain ?? (yield* Effect.die("The Domain is still there"));
  });

  /** One run of the Domain's verification job, as the worker runs it when it is due. */
  const runCheck = (customDomainId: string) =>
    emailVerifyCustomDomainHandler.handle(
      { customDomainId },
      { attempt: 1, enqueuedAt: Date.now(), id: "job_verify" },
    );

  /** Runs the job until the Domain's checks stop, and returns the wait each check set. */
  const checkUntilStopped = Effect.fn(function* (customDomainId: string) {
    const waits: number[] = [];
    for (;;) {
      yield* runCheck(customDomainId);
      const { lastCheckedAt, nextVerifyAt } = yield* domainOf(customDomainId);
      if (!(lastCheckedAt && nextVerifyAt)) {
        return waits;
      }
      waits.push((nextVerifyAt.getTime() - lastCheckedAt.getTime()) / MINUTE);
      if (waits.length > 100) {
        return yield* Effect.die("The Domain's checks never stopped");
      }
    }
  });

  const eventsOf = Effect.fn(function* (organizationId: string) {
    const db = yield* DB;
    return yield* db
      .select({ payload: webhookEvent.payload, type: webhookEvent.type })
      .from(webhookEvent)
      .where(eq(webhookEvent.organizationId, organizationId))
      .orderBy(webhookEvent.createdAt);
  });

  const checksScheduledFor = (
    { scheduled, scheduledAt }: Pick<ReturnType<typeof boundaries>, "scheduled" | "scheduledAt">,
    customDomainId: string,
  ) =>
    scheduled.flatMap((job, index) =>
      job.name === "email.verify-custom-domain" &&
      (job.payload as { readonly customDomainId: string }).customDomainId === customDomainId
        ? [scheduledAt[index] ?? Number.NaN]
        : [],
    );

  it.live("asks SES in the registration's region, and checks a verified Domain twice a day", () => {
    const { asked, dns, layer, ses, ...queue } = boundaries();
    return Effect.gen(function* () {
      const { customDomainId, fqdn, organizationId } = yield* addedDomain();
      ses.verified = true;
      dns.allPublished = true;

      yield* runCheck(customDomainId);

      expect(asked).toEqual([{ fqdn, region: "eu-central-1" }]);
      const domain = yield* domainOf(customDomainId);
      expect(domain).toMatchObject({
        registration: { verificationStatus: "verified" },
        verificationStatus: "verified",
        verifyBackoffLevel: 0,
      });
      const dueAt = domain.nextVerifyAt?.getTime() ?? Number.NaN;
      expect((dueAt - (domain.lastCheckedAt?.getTime() ?? 0)) / MINUTE).toBe(12 * 60);
      // Its job is scheduled for that check, after the one the add scheduled at once.
      expect(checksScheduledFor(queue, customDomainId).at(-1)).toBe(dueAt);
      expect(yield* eventsOf(organizationId)).toEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.live("keeps checking often while SES lags DNS records that are all published", () => {
    const { dns, layer } = boundaries();
    return Effect.gen(function* () {
      const { customDomainId } = yield* addedDomain();
      dns.allPublished = true;

      yield* runCheck(customDomainId);

      const domain = yield* domainOf(customDomainId);
      expect(domain.registration?.verificationStatus).toBe("not_verified");
      expect(
        ((domain.nextVerifyAt?.getTime() ?? 0) - (domain.lastCheckedAt?.getTime() ?? 0)) / MINUTE,
      ).toBe(2);
    }).pipe(Effect.provide(layer));
  });

  it.live.each([
    { state: "with nothing published", partly: false },
    { state: "with SES verified and a record still missing", partly: true },
  ])(
    "a Domain left unverified, $state, is checked less and less often, then not at all",
    ({ partly }) => {
      const { asked, layer, published, ses, ...queue } = boundaries();
      return Effect.gen(function* () {
        const db = yield* DB;
        const { customDomainId, organizationId } = yield* addedDomain();
        if (partly) {
          // Partially verified, which a Domain can stay for good: SES has verified it, and
          // one of its records is not in DNS.
          ses.verified = true;
          const [record] = yield* db.query.emailDnsRecord.findMany({ where: { customDomainId } });
          published.add(record?.value ?? (yield* Effect.die("The Domain has DNS records")));
        }

        const waits = yield* checkUntilStopped(customDomainId);

        // 22 checks over a week: the wait doubles to half a day, and the last check sets none.
        expect(waits).toEqual(UNVERIFIED_WAITS_IN_MINUTES);
        expect(asked).toHaveLength(UNVERIFIED_WAITS_IN_MINUTES.length + 1);
        expect(waits.reduce((total, wait) => total + wait, 0)).toBeLessThanOrEqual(7 * 24 * 60);

        // It is still the Project's Domain, unverified, with nothing scheduled past its last
        // check: the add's first check, then one after each check but the last.
        const stopped = yield* domainOf(customDomainId);
        expect(stopped).toMatchObject({
          nextVerifyAt: null,
          organizations: [{ organizationId, ownershipVerificationStatus: "verified" }],
          registration: { region: "eu-central-1" },
          verificationStatus: partly ? "partially_verified" : "not_verified",
        });
        expect(stopped.lastCheckedAt).not.toBeNull();
        expect(checksScheduledFor(queue, customDomainId)).toHaveLength(
          UNVERIFIED_WAITS_IN_MINUTES.length + 1,
        );

        // The Project is told, once.
        const told = [
          {
            payload: {
              checks_stopped: true,
              domain_id: customDomainId,
              paused: false,
              paused_reason: null,
              status: stopped.verificationStatus,
            },
            type: "domain.updated",
          },
        ];
        expect(yield* eventsOf(organizationId)).toEqual(told);

        // A worker that starts does not schedule it again, though it schedules a Domain no
        // check has run for.
        const unchecked = yield* addedDomain();
        queue.scheduled.length = 0;
        queue.scheduledAt.length = 0;
        yield* emailVerifyCustomDomainHandler.reconcile ?? Effect.die("The handler reconciles");
        expect(checksScheduledFor(queue, customDomainId)).toEqual([]);
        expect(checksScheduledFor(queue, unchecked.customDomainId)).toHaveLength(1);

        // A check that runs anyway, as a job left in the queue would, asks SES once and
        // leaves it stopped, telling nobody again.
        yield* runCheck(customDomainId);
        expect(yield* domainOf(customDomainId)).toMatchObject({
          nextVerifyAt: null,
          verifyBackoffLevel: stopped.verifyBackoffLevel,
        });
        expect(checksScheduledFor(queue, customDomainId)).toEqual([]);
        expect(yield* eventsOf(organizationId)).toEqual(told);
      }).pipe(Effect.provide(layer));
    },
  );

  it.live(
    "a Domain verified along the way is checked twice a day, and from the start if it lapses",
    () => {
      const { dns, layer, ses } = boundaries();
      return Effect.gen(function* () {
        const { customDomainId, organizationId } = yield* addedDomain();
        const waitSet = Effect.gen(function* () {
          yield* runCheck(customDomainId);
          const { lastCheckedAt, nextVerifyAt } = yield* domainOf(customDomainId);
          return ((nextVerifyAt?.getTime() ?? 0) - (lastCheckedAt?.getTime() ?? 0)) / MINUTE;
        });
        // Unverified for five checks: its records were not published yet.
        expect([
          yield* waitSet,
          yield* waitSet,
          yield* waitSet,
          yield* waitSet,
          yield* waitSet,
        ]).toEqual([2, 4, 8, 16, 32]);

        ses.verified = true;
        dns.allPublished = true;
        expect(yield* waitSet).toBe(12 * 60);
        expect(yield* domainOf(customDomainId)).toMatchObject({
          verificationStatus: "verified",
          verifyBackoffLevel: 0,
        });
        // However long it stays verified, it is checked at that pace and never stops.
        for (let check = 0; check < 30; check += 1) {
          expect(yield* waitSet).toBe(12 * 60);
        }

        // Its records are taken down: unverified from now, so its checks start over.
        dns.allPublished = false;
        expect([yield* waitSet, yield* waitSet]).toEqual([2, 4]);
        expect(yield* eventsOf(organizationId)).toEqual([]);
      }).pipe(Effect.provide(layer));
    },
  );

  it.live("the holder asking starts a stopped Domain's checks again, from the first wait", () => {
    const { layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const { customDomainId, organizationId } = yield* addedDomain();
      yield* checkUntilStopped(customDomainId);
      const stopped = yield* domainOf(customDomainId);
      const registration = stopped.registration ?? (yield* Effect.die("It is registered"));

      // As the dashboard's refresh checks it.
      const refreshed = yield* verifyCustomDomainRegistration({
        db,
        domain: stopped,
        registration,
        restart: true,
      });

      const domain = yield* domainOf(customDomainId);
      expect(refreshed.nextCheckAt).toEqual(domain.nextVerifyAt);
      expect(
        ((domain.nextVerifyAt?.getTime() ?? 0) - (domain.lastCheckedAt?.getTime() ?? 0)) / MINUTE,
      ).toBe(2);
      expect(domain.verifyBackoffLevel).toBe(1);
      // And from there as for a Domain just added, to the same end, told a second time.
      expect(yield* checkUntilStopped(customDomainId)).toEqual(
        UNVERIFIED_WAITS_IN_MINUTES.slice(1),
      );
      expect(
        (yield* eventsOf(organizationId)).map(
          ({ payload }) => (payload as { readonly checks_stopped: boolean }).checks_stopped,
        ),
      ).toEqual([true, true]);
    }).pipe(Effect.provide(layer));
  });

  it.live("a check keeps a restart made while it was asking SES", () => {
    const { layer, ses } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const { customDomainId, organizationId } = yield* addedDomain();
      // One check short of stopping, as a week unverified leaves it.
      const waits = UNVERIFIED_WAITS_IN_MINUTES.length;
      yield* db
        .update(customDomain)
        .set({ lastCheckedAt: new Date(), nextVerifyAt: new Date(), verifyBackoffLevel: waits })
        .where(eq(customDomain.id, customDomainId));
      // As a refresh or a proven claim writes, landing while this check waits on SES.
      ses.whileAsked = db
        .update(customDomain)
        .set({ nextVerifyAt: new Date(), verifyBackoffLevel: 0 })
        .where(eq(customDomain.id, customDomainId))
        .pipe(Effect.orDie);

      yield* runCheck(customDomainId);

      // Counted from the restart, not from what the check read before it: not stopped.
      const domain = yield* domainOf(customDomainId);
      expect(domain.verifyBackoffLevel).toBe(1);
      expect(
        ((domain.nextVerifyAt?.getTime() ?? 0) - (domain.lastCheckedAt?.getTime() ?? 0)) / MINUTE,
      ).toBe(2);
      expect(yield* eventsOf(organizationId)).toEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.live("a stopped Domain is checked again for the Project that proves a claim on it", () => {
    const { layer, published, ...queue } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const { customDomainId, fqdn, organizationId: holderId } = yield* addedDomain();
      yield* checkUntilStopped(customDomainId);
      const claimantId = yield* insertProject();
      queue.scheduled.length = 0;
      queue.scheduledAt.length = 0;
      expect(yield* createCustomDomain({ fqdn, organizationId: claimantId })).toMatchObject({
        kind: "claim",
      });
      // Making the claim checks nothing of the holder's Domain: another Project's claims
      // must not use up the checks its holder has left.
      expect(checksScheduledFor(queue, customDomainId)).toEqual([]);
      const claim = yield* db.query.organizationDomain.findFirst({
        where: { customDomainId, organizationId: claimantId },
      });
      published.add(
        ownershipChallengeValue(claim?.ownershipToken ?? (yield* Effect.die("A claim was made"))),
      );
      queue.scheduled.length = 0;
      queue.scheduledAt.length = 0;
      const before = Date.now();

      expect(
        yield* verifyCustomDomainOwnership({
          customDomain: yield* domainOf(customDomainId),
          db,
          organizationId: claimantId,
        }),
      ).toMatchObject({ ownershipVerificationStatus: "verified" });

      // Due now and counted from the start, for its new holder, with its job scheduled.
      const taken = yield* domainOf(customDomainId);
      expect(taken.organizations.map((link) => link.organizationId)).toEqual([claimantId]);
      expect(taken.verifyBackoffLevel).toBe(0);
      expect(taken.nextVerifyAt?.getTime()).toBeGreaterThanOrEqual(before);
      const [dueAt, ...others] = checksScheduledFor(queue, customDomainId);
      expect(others).toEqual([]);
      expect(dueAt).toBeGreaterThanOrEqual(before);
      expect(dueAt).toBeLessThanOrEqual(Date.now());

      // Its checks then run their course for the new holder, who is the one told.
      expect(yield* checkUntilStopped(customDomainId)).toEqual(UNVERIFIED_WAITS_IN_MINUTES);
      expect(yield* eventsOf(claimantId)).toMatchObject([
        { payload: { checks_stopped: true, domain_id: customDomainId }, type: "domain.updated" },
      ]);
      expect(yield* eventsOf(holderId)).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });
});
