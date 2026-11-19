/**
 * Setting up the Sandbox Domain against a real Postgres: that it is never made on a name a
 * Project holds as a custom Domain, that it is one Sandbox Domain whatever case its root is
 * typed in, and that its registration waits its turn for the name, replaces a removed
 * Domain's identity, gives up an SES call that never answers and is checked even when its
 * first check was never scheduled. SES, Cloudflare, public DNS and the job queue are the
 * boundaries stubbed, but for the Cloudflare call that never answers, which runs on the real
 * queue (#131).
 */
import { describe, expect, it, test } from "@effect/vitest";
import { JobEnqueueError, Jobs, type JobsService } from "@repo/jobs";
import { SELF_HOSTED_LIMITS } from "@repo/persistence/auth/plans";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import {
  customDomain,
  emailDomainRegistration,
  organization,
  organizationDomain,
  removedDomainIdentity,
  sandboxDomain,
  user,
  userChannel,
} from "@repo/persistence/db/schema";
import { eq, sql } from "drizzle-orm";
import { Deferred, Effect, Fiber, Layer, Schedule } from "effect";
import { TestClock } from "effect/testing";
import { typeid } from "typeid-js";
import { EmailBackend, EmailBackendIdentityConflict } from "../backend";
import { createOwnershipToken } from "../custom-domain/dns";
import { emailDeleteDomainIdentityHandler } from "../custom-domain/handlers";
import type { EmailDeleteDomainIdentityPayload } from "../custom-domain/jobs";
import {
  createCustomDomain,
  deleteCustomDomain,
  lockDomainIdentity,
} from "../custom-domain/lifecycle";
import { DnsLookups } from "../dns-lookups";
import { EmailManagedDns } from "../managed-dns";
import { recordedJobs } from "../recorded-jobs-test-layer";
import { emailVerifySandboxDomainHandler } from "../verification/handlers";
import { ensureSandboxDomain } from "./provision";
import { lockSandboxRoots } from "./reserved";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;

describe("ensureSandboxDomain (PostgreSQL and Redis)", () => {
  if (!(testDatabaseUrl && testRedisUrl)) {
    process.emitWarning(
      "Skipping Sandbox Domain tests: TEST_DATABASE_URL and TEST_REDIS_URL are not both set",
    );
    // The PostgreSQL and Redis test is opt-in.
    test.skip("ensureSandboxDomain", () => undefined);
    return;
  }

  /**
   * SES, Cloudflare, public DNS and the queue, and what each was asked to do. `identities` is
   * the SES account as SES keeps it: one identity to an FQDN, signing with one selector, which
   * a test may also fill with one Relayit did not make.
   */
  const boundaries = (
    options: {
      readonly createIdentityAnswers?: () => boolean;
      /** Whether Cloudflare answers the publishing of that owner's records; it does unless told. */
      readonly dnsAnswers?: (owner: string) => boolean;
      readonly failSchedule?: () => boolean;
      readonly onCreateIdentity?: () => Effect.Effect<void>;
      /** Runs as a publishing that will not be answered is asked for. */
      readonly onDnsUnanswered?: () => Effect.Effect<void>;
    } = {},
  ) => {
    const createdIdentities: string[] = [];
    const deletedIdentities: string[] = [];
    const identities = new Map<string, string>();
    const dnsOwners: string[] = [];
    const scheduled: unknown[] = [];
    /** When each of `scheduled` is due, in the same order. */
    const scheduledAt: number[] = [];
    const enqueued: unknown[] = [];
    const layer = Layer.mergeAll(
      Layer.succeed(EmailBackend, {
        createIdentity: ({ dkimSelector, fqdn, region }) =>
          (options.onCreateIdentity?.() ?? Effect.void).pipe(
            Effect.andThen(
              Effect.suspend(() => {
                if (options.createIdentityAnswers?.() === false) {
                  return Effect.never;
                }
                // SES keeps a domain's name in lower case, whatever case it was asked in.
                const existing = identities.get(fqdn.toLowerCase());
                if (existing !== undefined && existing !== dkimSelector) {
                  return Effect.fail(
                    new EmailBackendIdentityConflict({ fqdn, region: region ?? "eu-central-1" }),
                  );
                }
                identities.set(fqdn.toLowerCase(), dkimSelector);
                createdIdentities.push(fqdn);
                return Effect.succeed({ mailFrom: { domain: `send.${fqdn}`, records: [] } });
              }),
            ),
          ),
        defaultRegion: "eu-central-1",
        deleteIdentity: ({ dkimSelector, fqdn }) =>
          Effect.sync(() => {
            if (identities.get(fqdn.toLowerCase()) !== dkimSelector) {
              return false;
            }
            identities.delete(fqdn.toLowerCase());
            deletedIdentities.push(fqdn);
            return true;
          }),
        ensureInfrastructure: () => Effect.die("unused"),
        getIdentityStatus: () => Effect.die("unused"),
        getProjectSendingStatus: () => Effect.die("unused"),
        send: () => Effect.die("unused"),
      }),
      Layer.succeed(EmailManagedDns, {
        cloudflareEnabled: true,
        reconcile: ({ owner }) =>
          Effect.suspend(() => {
            if (options.dnsAnswers?.(owner) === false) {
              return (options.onDnsUnanswered?.() ?? Effect.void).pipe(
                Effect.andThen(Effect.never),
              );
            }
            dnsOwners.push(owner);
            return Effect.void;
          }),
        remove: () => Effect.void,
      }),
      Layer.succeed(DnsLookups, {
        detectProvider: () => Promise.resolve("cloudflare"),
        evaluate: () => Promise.resolve({ matches: false, warnings: [] }),
      }),
      Layer.succeed(Jobs, {
        cancel: (() => Effect.void) as JobsService["cancel"],
        enqueue: ((_contract: unknown, payload: unknown) => {
          enqueued.push(payload);
          return Effect.void;
        }) as JobsService["enqueue"],
        schedule: ((contract: { readonly name: string }, payload: unknown, at?: number) => {
          if (options.failSchedule?.()) {
            return Effect.fail(
              new JobEnqueueError({
                cause: "Redis is down",
                jobName: contract.name,
                stage: "schedule",
              }),
            );
          }
          scheduled.push(payload);
          scheduledAt.push(at ?? Number.NaN);
          return Effect.void;
        }) as JobsService["schedule"],
      }),
      SymmetricCrypto.live(parseBetterAuthSecrets("1:sandbox-test-secret-0123456789abc")),
    ).pipe(Layer.provideMerge(makeDbLive({ databaseUrl: testDatabaseUrl })));
    return {
      createdIdentities,
      deletedIdentities,
      dnsOwners,
      enqueued,
      identities,
      layer,
      scheduled,
      scheduledAt,
    };
  };

  /** A Project whose Plan sets no Domain limit, so it can add a Domain as the api does. */
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
    return id;
  });

  /**
   * Returns once a transaction is waiting for the advisory lock of that key, so a test
   * that holds the lock knows the code under test has reached it.
   */
  const awaitWaiterOn = Effect.fn(function* (key: string) {
    const db = yield* DB;
    yield* db
      .execute<{ waiting: boolean }>(
        sql`select exists (
          select 1 from pg_locks
          where locktype = 'advisory' and not granted
            and ((classid::bigint << 32) | objid::bigint) = hashtextextended(${key}, 0)
        ) as waiting`,
      )
      .pipe(
        Effect.repeat({
          schedule: Schedule.spaced("20 millis"),
          until: (result) => result.rows[0]?.waiting === true,
        }),
      );
  });

  const registrationsOf = Effect.fn(function* (sandboxDomainId: string | undefined) {
    const db = yield* DB;
    return yield* db
      .select({ region: emailDomainRegistration.region })
      .from(emailDomainRegistration)
      .where(eq(emailDomainRegistration.sandboxDomainId, sandboxDomainId ?? ""));
  });

  /** A custom Domain a Project holds, as an add left it. */
  const heldDomain = Effect.fn(function* (fqdn: string) {
    const db = yield* DB;
    const organizationId = typeid("orgn").toString();
    yield* db
      .insert(organization)
      .values({ id: organizationId, name: "Holder", slug: `holder-${organizationId}` });
    const [domain] = yield* db
      .insert(customDomain)
      .values({ dkimPrivateKey: "private", dkimPublicKey: "public", dkimSelector: "s", fqdn })
      .returning({ id: customDomain.id });
    const customDomainId = domain?.id ?? (yield* Effect.die("The Domain was written"));
    yield* db.insert(organizationDomain).values({
      customDomainId,
      organizationId,
      ownershipToken: createOwnershipToken(),
      ownershipVerificationStatus: "verified",
    });
    return customDomainId;
  });

  const sandboxesOn = Effect.fn(function* (root: string) {
    const db = yield* DB;
    return yield* db
      .select({ id: sandboxDomain.id })
      .from(sandboxDomain)
      .where(sql`lower(${sandboxDomain.rootDomain}) = lower(${root})`);
  });

  const newRoot = () => `${Bun.randomUUIDv7()}.sandbox.test`;

  it.live.each([
    { held: (root: string) => root, what: "the root itself" },
    { held: (root: string) => `mail.${root}`, what: "a name under it" },
    { held: (root: string) => `a.b.${root}`, what: "a name deeper under it" },
  ])("is not set up on a root where a Project holds $what", ({ held }) => {
    const { createdIdentities, dnsOwners, layer, scheduled } = boundaries();
    return Effect.gen(function* () {
      const root = newRoot();
      const customDomainId = yield* heldDomain(held(root));

      // As configured: a Domain's FQDN is stored lowercased, `CF_ROOT_DOMAIN` as typed.
      const refused = yield* Effect.flip(
        ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root.toUpperCase() }),
      );

      expect(refused).toMatchObject({
        _tag: "SandboxDomainRootHeld",
        customDomainId,
        fqdn: held(root),
        rootDomain: root.toUpperCase(),
      });
      expect(yield* sandboxesOn(root)).toEqual([]);
      expect({ createdIdentities, dnsOwners, scheduled }).toEqual({
        createdIdentities: [],
        dnsOwners: [],
        scheduled: [],
      });
    }).pipe(Effect.provide(layer));
  });

  it.live("is not registered on a root a Project holds, when its row is already there", () => {
    const { createdIdentities, dnsOwners, layer, scheduled } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const root = newRoot();
      // As a start left it that wrote the row and failed before SES: unregistered.
      yield* db.insert(sandboxDomain).values({
        cloudflareZoneId: "zone",
        dkimPrivateKey: "private",
        dkimPublicKey: "public",
        dkimSelector: "relayit",
        rootDomain: root,
      });
      yield* heldDomain(root);

      expect(
        yield* Effect.flip(ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root })),
      ).toMatchObject({ _tag: "SandboxDomainRootHeld" });

      const [sandbox] = yield* sandboxesOn(root);
      expect(
        yield* db
          .select({ id: emailDomainRegistration.id })
          .from(emailDomainRegistration)
          .where(eq(emailDomainRegistration.sandboxDomainId, sandbox?.id ?? "")),
      ).toEqual([]);
      expect({ createdIdentities, dnsOwners, scheduled }).toEqual({
        createdIdentities: [],
        dnsOwners: [],
        scheduled: [],
      });
    }).pipe(Effect.provide(layer));
  });

  it.live("is not registered onto an SES identity Relayit did not make, at any start", () => {
    const { createdIdentities, deletedIdentities, identities, layer, scheduled } = boundaries();
    return Effect.gen(function* () {
      const root = newRoot();
      identities.set(root, "someone-elses");

      // The first start writes the Sandbox Domain and is refused by SES; the next finds its
      // row unregistered and is refused the same.
      for (const _start of [1, 2]) {
        expect(
          yield* Effect.flip(ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root })),
        ).toMatchObject({
          _tag: "SandboxDomainError",
          cause: { _tag: "EmailBackendIdentityConflict", fqdn: root },
          message:
            "The sandbox root already has an SES identity that Relayit did not create; it was left untouched.",
        });
      }

      const sandboxes = yield* sandboxesOn(root);
      expect(sandboxes).toHaveLength(1);
      expect(yield* registrationsOf(sandboxes[0]?.id)).toEqual([]);
      expect(identities.get(root)).toBe("someone-elses");
      expect({ createdIdentities, deletedIdentities, scheduled }).toEqual({
        createdIdentities: [],
        deletedIdentities: [],
        scheduled: [],
      });
    }).pipe(Effect.provide(layer));
  });

  it.live("is set up beside a Domain whose name only ends with the root's letters", () => {
    const { createdIdentities, dnsOwners, layer, scheduled } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const root = newRoot();
      yield* heldDomain(`x${root}`);

      yield* ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root });

      const [sandbox] = yield* sandboxesOn(root);
      expect(createdIdentities).toEqual([root]);
      expect(scheduled).toEqual([{ sandboxDomainId: sandbox?.id }]);
      expect(
        yield* db
          .select({ region: emailDomainRegistration.region })
          .from(emailDomainRegistration)
          .where(eq(emailDomainRegistration.sandboxDomainId, sandbox?.id ?? "")),
      ).toEqual([{ region: "eu-central-1" }]);

      // Once it is registered, a Domain found on its root does not stop the next start: the
      // identity is the Sandbox Domain's by then, and nothing is created or scheduled again.
      // In whatever case the root is typed.
      yield* heldDomain(root);
      const dnsCalls = dnsOwners.length;
      expect(
        yield* ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root.toUpperCase() }),
      ).toBe(0);
      expect(createdIdentities).toEqual([root]);
      expect(scheduled).toHaveLength(1);
      expect(dnsOwners).toHaveLength(dnsCalls);
    }).pipe(Effect.provide(layer));
  });

  it.live("is one Sandbox Domain when its root is typed in another case", () => {
    const { createdIdentities, layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const root = newRoot();

      yield* ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root });
      // The next start finds the same Sandbox Domain, registers nothing and goes on to
      // the allocation sweep, which assigns no Project to one not verified yet.
      expect(
        yield* ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root.toUpperCase() }),
      ).toBe(0);

      expect(yield* sandboxesOn(root)).toHaveLength(1);
      expect(createdIdentities).toEqual([root]);

      // And the database refuses a second row for the name, however it is written.
      const refused = yield* Effect.flip(
        db.insert(sandboxDomain).values({
          cloudflareZoneId: "zone",
          dkimPrivateKey: "private",
          dkimPublicKey: "public",
          dkimSelector: "relayit",
          rootDomain: root.toUpperCase(),
        }),
      );
      expect(String(refused.cause)).toContain("sandbox_domain_root_domain_unique_idx");
    }).pipe(Effect.provide(layer));
  });

  it.live("keeps a root first typed in upper case as one lower-case Sandbox Domain", () => {
    const { createdIdentities, layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const root = newRoot();

      yield* ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root.toUpperCase() });
      yield* ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root });

      expect(
        yield* db
          .select({ rootDomain: sandboxDomain.rootDomain })
          .from(sandboxDomain)
          .where(sql`lower(${sandboxDomain.rootDomain}) = ${root}`),
      ).toEqual([{ rootDomain: root }]);
      expect(createdIdentities).toEqual([root]);
    }).pipe(Effect.provide(layer));
  });

  it.live("is checked after a start that could not schedule its first check", () => {
    let redisDown = true;
    const { layer, scheduled, scheduledAt } = boundaries({ failSchedule: () => redisDown });
    return Effect.gen(function* () {
      const db = yield* DB;
      const root = newRoot();
      // One a start left unregistered has nothing to check, and is not scheduled.
      const [unregistered] = yield* db
        .insert(sandboxDomain)
        .values({
          cloudflareZoneId: "zone",
          dkimPrivateKey: "private",
          dkimPublicKey: "public",
          dkimSelector: "relayit",
          rootDomain: newRoot(),
        })
        .returning({ id: sandboxDomain.id });

      expect(
        yield* Effect.flip(ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root })),
      ).toMatchObject({ _tag: "SandboxDomainError", operation: "schedule" });
      const [sandbox] = yield* sandboxesOn(root);
      expect(yield* registrationsOf(sandbox?.id)).toHaveLength(1);
      expect(scheduled).toEqual([]);

      redisDown = false;
      const before = Date.now();
      yield* emailVerifySandboxDomainHandler.reconcile ?? Effect.die("The handler reconciles");

      // Every Sandbox Domain in the database is reconciled, other tests' too.
      const at = scheduled.findIndex(
        (payload) => (payload as { sandboxDomainId?: string }).sandboxDomainId === sandbox?.id,
      );
      expect(at).toBeGreaterThanOrEqual(0);
      expect(scheduledAt[at]).toBeGreaterThanOrEqual(before);
      expect(scheduledAt[at]).toBeLessThanOrEqual(Date.now());
      expect(scheduled).not.toContainEqual({ sandboxDomainId: unregistered?.id });
    }).pipe(Effect.provide(layer));
  });

  it.live("replaces the identity a removed Domain left on its root", () => {
    const { deletedIdentities, enqueued, identities, layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const root = newRoot();
      const organizationId = yield* insertProject();
      const added = yield* createCustomDomain({ fqdn: root, organizationId });
      const removedSelector = identities.get(root);
      yield* deleteCustomDomain({ customDomainId: added.customDomainId, organizationId });
      // The Domain is gone and its delete job has not run: SES still holds its identity.
      expect(removedSelector).toBeDefined();
      expect(identities.get(root)).toBe(removedSelector);

      // As configured, in another case than the Domain's FQDN was kept in.
      yield* ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root.toUpperCase() });

      const [sandbox] = yield* db
        .select({ dkimSelector: sandboxDomain.dkimSelector, id: sandboxDomain.id })
        .from(sandboxDomain)
        .where(eq(sandboxDomain.rootDomain, root));
      expect(yield* registrationsOf(sandbox?.id)).toEqual([{ region: "eu-central-1" }]);
      expect(deletedIdentities).toEqual([root]);
      expect(identities.get(root)).toBe(sandbox?.dkimSelector);
      expect(identities.get(root)).not.toBe(removedSelector);
      expect(
        yield* db
          .select({ id: removedDomainIdentity.id })
          .from(removedDomainIdentity)
          .where(eq(removedDomainIdentity.fqdn, root)),
      ).toEqual([]);

      // The removed Domain's job, running late, leaves the Sandbox Domain's identity.
      const [job] = enqueued as EmailDeleteDomainIdentityPayload[];
      expect(job).toMatchObject({ dkimSelector: removedSelector, fqdn: root });
      yield* emailDeleteDomainIdentityHandler.handle(job ?? (yield* Effect.die("A job")), {
        attempt: 1,
        enqueuedAt: Date.now(),
        id: "job_1",
      });
      expect(identities.get(root)).toBe(sandbox?.dkimSelector);
    }).pipe(Effect.provide(layer));
  });

  it.live("waits for the root's identity lock before it registers", () => {
    const { createdIdentities, layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const root = newRoot();
      const locked = yield* Deferred.make<void>();
      const release = yield* Deferred.make<void>();
      // As a delete job or a custom Domain's registration holds the name.
      const holder = yield* Effect.forkChild(
        db.transaction((tx) =>
          lockDomainIdentity(tx, root).pipe(
            Effect.andThen(Deferred.succeed(locked, undefined)),
            Effect.andThen(Deferred.await(release)),
          ),
        ),
      );
      yield* Deferred.await(locked);

      const starting = yield* Effect.forkChild(
        ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root.toUpperCase() }),
      );
      yield* awaitWaiterOn(`custom-domain-identity:${root}`);
      const [sandbox] = yield* sandboxesOn(root);
      expect(sandbox).toBeDefined();
      expect(createdIdentities).toEqual([]);
      expect(yield* registrationsOf(sandbox?.id)).toEqual([]);

      yield* Deferred.succeed(release, undefined);
      yield* Fiber.join(holder);
      yield* Fiber.join(starting);
      expect(createdIdentities).toEqual([root]);
      expect(yield* registrationsOf(sandbox?.id)).toHaveLength(1);
    }).pipe(Effect.provide(layer));
  });

  it.effect("gives up an SES call that never answers, and the next start registers it", () => {
    let answers = false;
    let reached: Deferred.Deferred<void> | undefined;
    const { createdIdentities, layer, scheduled } = boundaries({
      createIdentityAnswers: () => answers,
      onCreateIdentity: () => (reached ? Deferred.succeed(reached, undefined) : Effect.void),
    });
    return Effect.gen(function* () {
      const root = newRoot();
      const calling = yield* Deferred.make<void>();
      reached = calling;

      const starting = yield* Effect.forkChild(
        Effect.flip(ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root })),
      );
      yield* Deferred.await(calling);
      yield* TestClock.adjust("30 seconds");
      expect(yield* Fiber.join(starting)).toMatchObject({
        _tag: "SandboxDomainError",
        message: "SES did not answer in time while registering the sandbox domain.",
        operation: "register_identity",
      });
      const [sandbox] = yield* sandboxesOn(root);
      expect(yield* registrationsOf(sandbox?.id)).toEqual([]);
      expect(scheduled).toEqual([]);

      // Giving up released the name's lock and kept the row and its key for the next start.
      answers = true;
      yield* ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root });
      expect(yield* sandboxesOn(root)).toEqual([sandbox]);
      expect(createdIdentities).toEqual([root]);
      expect(yield* registrationsOf(sandbox?.id)).toHaveLength(1);
      expect(scheduled).toEqual([{ sandboxDomainId: sandbox?.id }]);
    }).pipe(Effect.provide(layer));
  });

  it.effect.each([
    {
      identities: 0,
      message: "Cloudflare did not answer in time while publishing the sandbox domain's root DNS.",
      operation: "create",
      records: "root",
      what: "its root's DKIM and DMARC records",
    },
    {
      identities: 1,
      message:
        "Cloudflare did not answer in time while publishing the sandbox domain's MAIL FROM DNS.",
      operation: "register_identity",
      records: "identity",
      what: "its MAIL FROM records",
    },
  ])(
    "gives up a Cloudflare call for $what that never answers, and the next start registers it",
    ({ identities, message, operation, records }) => {
      let answers = false;
      let reached: Deferred.Deferred<void> | undefined;
      const { createdIdentities, dnsOwners, layer } = boundaries({
        dnsAnswers: (owner) => answers || !owner.endsWith(`:${records}`),
        onDnsUnanswered: () => (reached ? Deferred.succeed(reached, undefined) : Effect.void),
      });
      // The real queue in place of the stub: the first check is scheduled in Redis.
      const queue = recordedJobs(testRedisUrl);
      return Effect.gen(function* () {
        const root = newRoot();
        const calling = yield* Deferred.make<void>();
        reached = calling;

        const starting = yield* Effect.forkChild(
          Effect.flip(ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root })),
        );
        yield* Deferred.await(calling);
        yield* TestClock.adjust("30 seconds");
        expect(yield* Fiber.join(starting)).toMatchObject({
          _tag: "SandboxDomainError",
          message,
          operation,
        });
        const [sandbox] = yield* sandboxesOn(root);
        expect(sandbox).toBeDefined();
        expect(yield* registrationsOf(sandbox?.id)).toEqual([]);
        expect(queue.scheduled).toEqual([]);
        expect(createdIdentities).toHaveLength(identities);

        // Giving up released the name's lock and kept the row and its key: the next start
        // publishes both sets of records and registers the same Sandbox Domain.
        answers = true;
        yield* ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root });
        expect(yield* sandboxesOn(root)).toEqual([sandbox]);
        expect(yield* registrationsOf(sandbox?.id)).toEqual([{ region: "eu-central-1" }]);
        expect(dnsOwners).toEqual(
          expect.arrayContaining([
            `sandbox:${sandbox?.id}:root`,
            `sandbox:${sandbox?.id}:identity`,
          ]),
        );
        expect(queue.scheduled).toEqual([
          { name: "email.verify-sandbox-domain", payload: { sandboxDomainId: sandbox?.id } },
        ]);
      }).pipe(Effect.provide(Layer.merge(layer, queue.layer)));
    },
  );

  it.live("is refused for a Domain being added on its root as it is set up", () => {
    const { createdIdentities, layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const root = newRoot();
      const written = yield* Deferred.make<void>();
      const commit = yield* Deferred.make<void>();
      // An add of the root that has written its Domain and not yet committed, holding the
      // lock `createCustomDomain` writes it under.
      const adding = yield* Effect.forkChild(
        db.transaction((tx) =>
          Effect.gen(function* () {
            yield* lockSandboxRoots(tx, "shared");
            yield* tx.insert(customDomain).values({
              dkimPrivateKey: "private",
              dkimPublicKey: "public",
              dkimSelector: "s",
              fqdn: root,
            });
            yield* Deferred.succeed(written, undefined);
            yield* Deferred.await(commit);
          }),
        ),
      );
      yield* Deferred.await(written);

      const starting = yield* Effect.forkChild(
        Effect.flip(ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root })),
      );
      yield* awaitWaiterOn("sandbox-domain-roots");
      expect(yield* sandboxesOn(root)).toEqual([]);

      yield* Deferred.succeed(commit, undefined);
      yield* Fiber.join(adding);
      expect(yield* Fiber.join(starting)).toMatchObject({
        _tag: "SandboxDomainRootHeld",
        fqdn: root,
      });
      expect(yield* sandboxesOn(root)).toEqual([]);
      expect(createdIdentities).toEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.live("refuses a Domain added under its root as it is set up", () => {
    const { createdIdentities, layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const root = newRoot();
      const organizationId = yield* insertProject();
      const written = yield* Deferred.make<void>();
      const commit = yield* Deferred.make<void>();
      // A start that has written the Sandbox Domain and not yet committed, holding the lock
      // `ensureSandboxDomain` writes it under.
      const starting = yield* Effect.forkChild(
        db.transaction((tx) =>
          Effect.gen(function* () {
            yield* lockSandboxRoots(tx, "exclusive");
            yield* tx.insert(sandboxDomain).values({
              cloudflareZoneId: "zone",
              dkimPrivateKey: "private",
              dkimPublicKey: "public",
              dkimSelector: "relayit",
              rootDomain: root,
            });
            yield* Deferred.succeed(written, undefined);
            yield* Deferred.await(commit);
          }),
        ),
      );
      yield* Deferred.await(written);

      const adding = yield* Effect.forkChild(
        Effect.flip(createCustomDomain({ fqdn: `mail.${root}`, organizationId })),
      );
      yield* awaitWaiterOn("sandbox-domain-roots");
      yield* Deferred.succeed(commit, undefined);
      yield* Fiber.join(starting);

      expect(yield* Fiber.join(adding)).toMatchObject({
        _tag: "CustomDomainReserved",
        fqdn: `mail.${root}`,
      });
      expect(
        yield* db
          .select({ id: customDomain.id })
          .from(customDomain)
          .where(eq(customDomain.fqdn, `mail.${root}`)),
      ).toEqual([]);
      expect(createdIdentities).toEqual([]);
    }).pipe(Effect.provide(layer));
  });
});
