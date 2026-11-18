import { describe, expect, it, test } from "@effect/vitest";
import { EmailBackend } from "@repo/channels/email/backend";
import { pauseCustomDomain } from "@repo/channels/email/custom-domain/lifecycle";
import { syncProjectSendingStatus } from "@repo/channels/email/deliverability";
import { JobsLive } from "@repo/jobs";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import {
  customDomain,
  emailDomainRegistration,
  organization,
  organizationDomain,
  webhookEndpoint,
} from "@repo/persistence/db/schema";
import { makeRedisLive } from "@repo/redis";
import { Effect, Layer } from "effect";
import { typeid } from "typeid-js";
import { makeFakeEmailBackend } from "./fake";
import { sesTenantNameFor } from "./tenant-name";
import { projectOfTenantStatusEvent } from "./tenant-status";
import {
  TENANT_STATUS_EVENTS,
  TENANT_STATUS_EVENTS_TOPIC,
  tenantStatusEventFor,
} from "./tenant-status.fixtures";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;

/** The region the observed events are from, and where the Projects' Domains are registered. */
const REGION = TENANT_STATUS_EVENTS.disabled.region;

/** A Project holding one Domain per entry of `regions`, told of every Domain change. */
const seedProject = (regions: readonly (string | null)[] = [REGION]) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const organizationId = typeid("orgn").toString();
    yield* db.insert(organization).values({
      id: organizationId,
      name: "Tenant status",
      slug: organizationId.replaceAll("_", "-"),
    });
    yield* db.insert(webhookEndpoint).values({
      eventTypes: ["domain.updated"],
      organizationId,
      signingSecret: "whsec_test",
      url: "https://hooks.relayit.test/events",
    });
    const domainIds = yield* Effect.forEach(regions, (region) =>
      Effect.gen(function* () {
        const customDomainId = typeid("domn").toString();
        yield* db.insert(customDomain).values({
          dkimPrivateKey: "unused",
          dkimPublicKey: "unused",
          dkimSelector: "relayit",
          fqdn: `${customDomainId}.relayit.test`,
          id: customDomainId,
          verificationStatus: "verified",
        });
        yield* db.insert(organizationDomain).values({
          customDomainId,
          organizationId,
          ownershipToken: Bun.randomUUIDv7(),
          ownershipVerificationStatus: "verified",
        });
        yield* db
          .insert(emailDomainRegistration)
          .values({ customDomainId, region, verificationStatus: "verified" });
        return customDomainId;
      }),
    );
    return { domainIds, organizationId };
  });

const pauseOf = (customDomainId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    return yield* db.query.customDomain.findFirst({
      columns: { isPaused: true, pausedReason: true },
      where: { id: customDomainId },
    });
  });

const NOT_PAUSED = { isPaused: false, pausedReason: null };
const PAUSED_BY_RELAYIT = { isPaused: true, pausedReason: "project_sending_pause" };

/** The Webhook Events a Project was sent, oldest first. */
const eventsOf = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    return yield* db.query.webhookEvent.findMany({
      columns: { payload: true, type: true },
      orderBy: { createdAt: "asc" },
      where: { organizationId },
    });
  });

describe("SES tenant status events (PostgreSQL, Redis, the fake backend)", () => {
  if (!(testDatabaseUrl && testRedisUrl)) {
    process.emitWarning(
      "Skipping SES tenant status tests: TEST_DATABASE_URL or TEST_REDIS_URL unset",
    );
    // The PostgreSQL and Redis test is opt-in.
    test.skip("SES tenant status events", () => undefined);
    return;
  }

  const services = Layer.mergeAll(
    makeDbLive({ databaseUrl: testDatabaseUrl }),
    JobsLive.pipe(
      Layer.provide(makeRedisLive({ keyPrefix: `test:${Bun.randomUUIDv7()}:`, url: testRedisUrl })),
    ),
  );

  /**
   * One test's world: the fake standing in for SES, and `deliver`, which takes an event as
   * the api does once SNS's checks have passed. `asked` counts the reads of SES.
   */
  const ses = Effect.gen(function* () {
    const db = yield* DB;
    const fake = yield* makeFakeEmailBackend(REGION);
    let asked = 0;
    const backend = {
      ...fake,
      getProjectSendingStatus: (input: Parameters<typeof fake.getProjectSendingStatus>[0]) => {
        asked += 1;
        return fake.getProjectSendingStatus(input);
      },
    };
    return {
      asked: () => asked,
      deliver: (event: Record<string, unknown>) => {
        const project = projectOfTenantStatusEvent(event, TENANT_STATUS_EVENTS_TOPIC);
        return project
          ? syncProjectSendingStatus(db, project).pipe(Effect.provideService(EmailBackend, backend))
          : Effect.succeed(undefined);
      },
      setPaused: fake.setProjectSendingPaused,
    };
  });
  const withSes = <A, E, R>(body: (world: Effect.Success<typeof ses>) => Effect.Effect<A, E, R>) =>
    ses.pipe(Effect.flatMap(body), Effect.scoped, Effect.provide(services));

  const eventFor = (kind: keyof typeof TENANT_STATUS_EVENTS, organizationId: string) =>
    tenantStatusEventFor(TENANT_STATUS_EVENTS[kind], sesTenantNameFor(organizationId));

  it.live("pauses the Domains of a Project SES has paused, and no other Project's", () =>
    withSes(({ deliver, setPaused }) =>
      Effect.gen(function* () {
        const project = yield* seedProject([REGION, REGION]);
        const bystander = yield* seedProject();
        yield* setPaused(project.organizationId, true);

        expect(yield* deliver(eventFor("disabled", project.organizationId))).toEqual({
          domains: 2,
          status: "paused",
        });

        for (const domainId of project.domainIds) {
          expect(yield* pauseOf(domainId)).toEqual(PAUSED_BY_RELAYIT);
        }
        expect(
          (yield* eventsOf(project.organizationId)).map(({ payload, type }) => ({ payload, type })),
        ).toEqual(
          expect.arrayContaining(
            project.domainIds.map((domain_id) => ({
              payload: {
                domain_id,
                paused: true,
                paused_reason: "project_sending_pause",
                status: "verified",
              },
              type: "domain.updated",
            })),
          ),
        );
        expect(yield* pauseOf(bystander.domainIds[0] ?? "")).toEqual(NOT_PAUSED);
        expect(yield* eventsOf(bystander.organizationId)).toEqual([]);
      }),
    ),
  );

  it.live("pauses nothing for a late disabled event when SES has enabled the tenant since", () =>
    withSes(({ asked, deliver }) =>
      Effect.gen(function* () {
        const project = yield* seedProject();

        // The tenant was disabled and enabled again before this event arrived.
        expect(yield* deliver(eventFor("disabled", project.organizationId))).toEqual({
          domains: 0,
          status: "enabled",
        });

        expect(asked()).toBe(1);
        expect(yield* pauseOf(project.domainIds[0] ?? "")).toEqual(NOT_PAUSED);
        expect(yield* eventsOf(project.organizationId)).toEqual([]);
      }),
    ),
  );

  it.live("keeps the pause for a late enabled event while SES still pauses the tenant", () =>
    withSes(({ deliver, setPaused }) =>
      Effect.gen(function* () {
        const project = yield* seedProject();
        yield* setPaused(project.organizationId, true);
        yield* deliver(eventFor("disabled", project.organizationId));

        for (const kind of ["enabled", "reinstated"] as const) {
          yield* deliver(eventFor(kind, project.organizationId));
          expect(yield* pauseOf(project.domainIds[0] ?? "")).toEqual(PAUSED_BY_RELAYIT);
        }
        expect(yield* eventsOf(project.organizationId)).toHaveLength(1);
      }),
    ),
  );

  it.live.each(["enabled", "reinstated"] as const)(
    "unpauses on a tenant SES reports %s only the Domains it paused itself",
    (kind) =>
      withSes(({ deliver, setPaused }) =>
        Effect.gen(function* () {
          const project = yield* seedProject([REGION, REGION, REGION]);
          const [automatic = "", forReputation = "", byHand = ""] = project.domainIds;
          // An admin paused two of them first, one giving reputation as the reason.
          yield* pauseCustomDomain({ customDomainId: forReputation, reason: "bad_reputation" });
          yield* pauseCustomDomain({ customDomainId: byHand, reason: "manual_admin_pause" });
          yield* setPaused(project.organizationId, true);
          expect(yield* deliver(eventFor("disabled", project.organizationId))).toEqual({
            domains: 1,
            status: "paused",
          });
          // The admin's pauses are not taken over.
          expect(yield* pauseOf(forReputation)).toEqual({
            isPaused: true,
            pausedReason: "bad_reputation",
          });

          yield* setPaused(project.organizationId, false);
          expect(yield* deliver(eventFor(kind, project.organizationId))).toEqual({
            domains: 1,
            status: "enabled",
          });

          expect(yield* pauseOf(automatic)).toEqual(NOT_PAUSED);
          expect(yield* pauseOf(forReputation)).toEqual({
            isPaused: true,
            pausedReason: "bad_reputation",
          });
          expect(yield* pauseOf(byHand)).toEqual({
            isPaused: true,
            pausedReason: "manual_admin_pause",
          });
          expect(yield* eventsOf(project.organizationId)).toMatchObject([
            { payload: { domain_id: automatic, paused: true }, type: "domain.updated" },
            {
              payload: { domain_id: automatic, paused: false, paused_reason: null },
              type: "domain.updated",
            },
          ]);
        }),
      ),
  );

  it.live("leaves paused a Domain an admin paused after Relayit did", () =>
    withSes(({ deliver, setPaused }) =>
      Effect.gen(function* () {
        const project = yield* seedProject();
        const [domainId = ""] = project.domainIds;
        yield* setPaused(project.organizationId, true);
        yield* deliver(eventFor("disabled", project.organizationId));
        // The admin decides it stays paused whatever SES does next.
        yield* pauseCustomDomain({ customDomainId: domainId, reason: "bad_reputation" });

        yield* setPaused(project.organizationId, false);
        yield* deliver(eventFor("enabled", project.organizationId));

        expect(yield* pauseOf(domainId)).toEqual({
          isPaused: true,
          pausedReason: "bad_reputation",
        });
      }),
    ),
  );

  it.live("pauses only the Domains registered in the region SES paused the Project in", () =>
    withSes(({ deliver, setPaused }) =>
      Effect.gen(function* () {
        // A registration with no region is in the default one, which is the events' here.
        const project = yield* seedProject([REGION, null, "us-east-1"]);
        const [here = "", unrecorded = "", elsewhere = ""] = project.domainIds;
        yield* setPaused(project.organizationId, true);

        yield* deliver(eventFor("disabled", project.organizationId));

        expect(yield* pauseOf(here)).toEqual(PAUSED_BY_RELAYIT);
        expect(yield* pauseOf(unrecorded)).toEqual(PAUSED_BY_RELAYIT);
        expect(yield* pauseOf(elsewhere)).toEqual(NOT_PAUSED);
      }),
    ),
  );

  it.live("ignores a tenant that is no Project of this deployment, without asking SES", () =>
    withSes(({ asked, deliver }) =>
      Effect.gen(function* () {
        const project = yield* seedProject();

        // The tenant the events were observed on: named like Relayit's, no Project's.
        expect(yield* deliver(TENANT_STATUS_EVENTS.disabled)).toEqual({
          domains: 0,
          status: "unknown_project",
        });
        // A Project that is gone, or never was: its id finds nothing.
        expect(yield* deliver(eventFor("disabled", typeid("orgn").toString()))).toEqual({
          domains: 0,
          status: "unknown_project",
        });
        expect(
          yield* deliver(tenantStatusEventFor(TENANT_STATUS_EVENTS.disabled, "someone-elses")),
        ).toBeUndefined();

        expect(asked()).toBe(0);
        expect(yield* pauseOf(project.domainIds[0] ?? "")).toEqual(NOT_PAUSED);
      }),
    ),
  );

  it.live("tells the Project once of a pause SES reports twice", () =>
    withSes(({ deliver, setPaused }) =>
      Effect.gen(function* () {
        const project = yield* seedProject();
        yield* setPaused(project.organizationId, true);
        const event = eventFor("disabled", project.organizationId);

        // SNS delivers at least once, and two deliveries can be handled at the same time.
        yield* Effect.all([deliver(event), deliver(event)], { concurrency: "unbounded" });
        yield* deliver(event);

        expect(yield* eventsOf(project.organizationId)).toMatchObject([
          { payload: { paused: true }, type: "domain.updated" },
        ]);
      }),
    ),
  );

  it.live("refuses the event, pausing nothing, when SES cannot be asked", () =>
    Effect.gen(function* () {
      const db = yield* DB;
      const project = yield* seedProject();
      const event = eventFor("disabled", project.organizationId);
      const named = projectOfTenantStatusEvent(event, TENANT_STATUS_EVENTS_TOPIC);
      if (!named) {
        return yield* Effect.die("the event names no Project");
      }
      const fake = yield* makeFakeEmailBackend(REGION);

      const error = yield* syncProjectSendingStatus(db, named).pipe(
        Effect.provideService(EmailBackend, {
          ...fake,
          getProjectSendingStatus: () => Effect.die("SES is unreachable"),
        }),
        Effect.exit,
      );

      expect(error._tag).toBe("Failure");
      expect(yield* pauseOf(project.domainIds[0] ?? "")).toEqual(NOT_PAUSED);
    }).pipe(Effect.scoped, Effect.provide(services)),
  );
});
