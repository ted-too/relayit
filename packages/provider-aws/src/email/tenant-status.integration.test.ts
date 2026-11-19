import { describe, expect, it, test } from "@effect/vitest";
import {
  EmailBackend,
  EmailBackendAuthenticationError,
  EmailBackendConfigurationError,
  EmailBackendUnavailable,
} from "@repo/channels/email/backend";
import {
  pauseCustomDomain,
  unpauseCustomDomain,
} from "@repo/channels/email/custom-domain/lifecycle";
import {
  emailRecheckProjectSendingPauseHandler,
  emailRecheckProjectSendingPauseJob,
  pauseProjectDomains,
  syncProjectSendingStatus,
} from "@repo/channels/email/deliverability";
import {
  DeadLetterStoreLive,
  JobEnqueueError,
  Jobs,
  JobsLive,
  promoteDelayedJobs,
  registerJobHandler,
} from "@repo/jobs";
import { jobDeadLetter } from "@repo/jobs/dead-letter-schema";
import { JOB_WORKER_GROUP } from "@repo/jobs/storage";
import { processJobBatch, promoteScheduledJobs } from "@repo/jobs/worker";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import {
  customDomain,
  emailDomainRegistration,
  organization,
  organizationDomain,
  webhookEndpoint,
} from "@repo/persistence/db/schema";
import { makeRedisLive, Redis } from "@repo/redis";
import { Deferred, Effect, Fiber, Layer, Logger } from "effect";
import { TestClock } from "effect/testing";
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

/** A Domain the Project holds, registered in `region`, in the pause state given. */
const addDomain = (
  organizationId: string,
  region: string | null,
  pause: Pick<typeof customDomain.$inferInsert, "isPaused" | "pausedReason"> = {},
) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const customDomainId = typeid("domn").toString();
    yield* db.insert(customDomain).values({
      ...pause,
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
  });

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
    const domainIds = yield* Effect.forEach(regions, (region) => addDomain(organizationId, region));
    return { domainIds, organizationId };
  });

/** A pause of Relayit's own as it is in the database, with nothing scheduled for it. */
const PAUSED_UNSCHEDULED = { isPaused: true, pausedReason: "project_sending_pause" } as const;

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

  const services = Layer.mergeAll(JobsLive, DeadLetterStoreLive).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        makeDbLive({ databaseUrl: testDatabaseUrl }),
        makeRedisLive({ keyPrefix: `test:${Bun.randomUUIDv7()}:`, url: testRedisUrl }),
      ),
    ),
  );

  const rechecker = registerJobHandler(emailRecheckProjectSendingPauseHandler);
  const recheckSchedule = rechecker.scheduledKey;
  /** When the Project's next recheck is due, as Redis holds it; `undefined` when none is. */
  const nextRecheckAt = (organizationId: string) =>
    Effect.gen(function* () {
      const redis = yield* Redis;
      const at = yield* redis.evaluateNumber({
        args: [
          emailRecheckProjectSendingPauseJob.recurrence.identity({
            organizationId,
            region: REGION,
          }),
        ],
        keys: [recheckSchedule ?? ""],
        script: `local at = redis.call("ZSCORE", KEYS[1], ARGV[1])
if at then return tonumber(at) end
return -1`,
      });
      return at === -1 ? undefined : at;
    });
  const recheckJob = (organizationId: string) =>
    emailRecheckProjectSendingPauseHandler.handle(
      { organizationId, region: REGION },
      { attempt: 1, enqueuedAt: Date.now(), id: "job_recheck" },
    );

  /**
   * One test's world: the fake standing in for SES, `deliver`, which takes an event as the
   * api does once SNS's checks have passed, and `recheck`, one run of the worker's job.
   * `asked` counts the reads of SES.
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
      backend,
      deliver: (event: Record<string, unknown>) => {
        const project = projectOfTenantStatusEvent(event, TENANT_STATUS_EVENTS_TOPIC);
        return project
          ? syncProjectSendingStatus(db, project).pipe(Effect.provideService(EmailBackend, backend))
          : Effect.succeed(undefined);
      },
      /** What the delivery handler does when SES refuses a send for the Project. */
      pauseFromRefusedSend: (organizationId: string) =>
        db.transaction((tx) =>
          pauseProjectDomains(tx, { defaultRegion: REGION, organizationId, region: REGION }),
        ),
      recheck: (organizationId: string) =>
        recheckJob(organizationId).pipe(Effect.provideService(EmailBackend, backend)),
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
          const automaticEvents = (yield* eventsOf(project.organizationId)).filter(
            ({ payload }) => (payload as { readonly domain_id: string }).domain_id === automatic,
          );
          expect(automaticEvents).toMatchObject([
            { payload: { paused: true }, type: "domain.updated" },
            { payload: { paused: false, paused_reason: null }, type: "domain.updated" },
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

  describe("the recheck job", () => {
    it.live("lifts a pause a refused send committed after SES restored the Project", () =>
      withSes(({ asked, deliver, pauseFromRefusedSend, recheck }) =>
        Effect.gen(function* () {
          const project = yield* seedProject();
          const [domainId = ""] = project.domainIds;
          // SES refused a send, restored the tenant, and the api handled the "enabled" event
          // (finding nothing to unpause) before the handler's pause was written.
          yield* deliver(eventFor("enabled", project.organizationId));
          expect(yield* nextRecheckAt(project.organizationId)).toBeUndefined();
          const before = Date.now();
          expect(yield* pauseFromRefusedSend(project.organizationId)).toBe(1);
          expect(yield* pauseOf(domainId)).toEqual(PAUSED_BY_RELAYIT);
          // The pause asked for its own recheck, five minutes on.
          const first = yield* nextRecheckAt(project.organizationId);
          expect(first).toBeGreaterThanOrEqual(before + 5 * 60_000);
          expect(first).toBeLessThan(before + 6 * 60_000);

          yield* recheck(project.organizationId);

          expect(yield* pauseOf(domainId)).toEqual(NOT_PAUSED);
          expect(yield* eventsOf(project.organizationId)).toMatchObject([
            { payload: { domain_id: domainId, paused: true }, type: "domain.updated" },
            { payload: { domain_id: domainId, paused: false }, type: "domain.updated" },
          ]);
          // The run after it finds nothing paused: it asks SES nothing, tells nobody and
          // schedules no other, which is how the rechecks end.
          const scheduled = yield* nextRecheckAt(project.organizationId);
          const reads = asked();
          yield* recheck(project.organizationId);
          expect(asked()).toBe(reads);
          expect(yield* eventsOf(project.organizationId)).toHaveLength(2);
          expect(yield* nextRecheckAt(project.organizationId)).toBe(scheduled);
        }),
      ),
    );

    it.live("keeps the pause, and keeps checking, while SES still pauses the Project", () =>
      withSes(({ asked, deliver, recheck, setPaused }) =>
        Effect.gen(function* () {
          const project = yield* seedProject();
          yield* setPaused(project.organizationId, true);
          yield* deliver(eventFor("disabled", project.organizationId));
          const before = asked();
          const fromPause = (yield* nextRecheckAt(project.organizationId)) ?? 0;

          yield* Effect.sleep("5 millis");
          yield* recheck(project.organizationId);
          const afterFirst = (yield* nextRecheckAt(project.organizationId)) ?? 0;
          yield* Effect.sleep("5 millis");
          yield* recheck(project.organizationId);
          const afterSecond = (yield* nextRecheckAt(project.organizationId)) ?? 0;

          expect(asked() - before).toBe(2);
          expect(yield* pauseOf(project.domainIds[0] ?? "")).toEqual(PAUSED_BY_RELAYIT);
          expect(yield* eventsOf(project.organizationId)).toHaveLength(1);
          // Each run moved the next one on.
          expect(afterFirst).toBeGreaterThan(fromPause);
          expect(afterSecond).toBeGreaterThan(afterFirst);
        }),
      ),
    );

    it.live("keeps the recheck of a pause that is committing as an earlier one is lifted", () =>
      withSes(({ pauseFromRefusedSend, recheck }) =>
        Effect.gen(function* () {
          const db = yield* DB;
          const project = yield* seedProject();
          const [lifted = ""] = project.domainIds;
          yield* pauseFromRefusedSend(project.organizationId);
          const refusedAgain = yield* addDomain(project.organizationId, REGION);

          // A send is refused again: its transaction has paused the Project's other Domain
          // and scheduled the recheck, and has not committed when the recheck of the first
          // pause runs, finds SES enabled and unpauses. That run cannot see the new pause.
          const paused = yield* Deferred.make<void>();
          const commit = yield* Deferred.make<void>();
          const refusedSend = yield* Effect.forkChild(
            db.transaction((tx) =>
              pauseProjectDomains(tx, {
                defaultRegion: REGION,
                organizationId: project.organizationId,
                region: REGION,
              }).pipe(
                Effect.andThen(Deferred.succeed(paused, undefined)),
                Effect.andThen(Deferred.await(commit)),
              ),
            ),
          );
          yield* Deferred.await(paused);
          yield* recheck(project.organizationId);
          expect(yield* pauseOf(lifted)).toEqual(NOT_PAUSED);
          expect(yield* pauseOf(refusedAgain)).toEqual(NOT_PAUSED);
          yield* Deferred.succeed(commit, undefined);
          yield* Fiber.join(refusedSend);

          // The pause that has now landed still has the recheck that will lift it.
          expect(yield* pauseOf(refusedAgain)).toEqual(PAUSED_BY_RELAYIT);
          expect(yield* nextRecheckAt(project.organizationId)).toBeGreaterThan(Date.now());
          yield* recheck(project.organizationId);
          expect(yield* pauseOf(refusedAgain)).toEqual(NOT_PAUSED);
        }),
      ),
    );

    it.live("never touches a Domain an admin paused, and asks SES nothing for one", () =>
      withSes(({ asked, pauseFromRefusedSend, recheck }) =>
        Effect.gen(function* () {
          const admins = yield* seedProject();
          yield* pauseCustomDomain({
            customDomainId: admins.domainIds[0] ?? "",
            reason: "bad_reputation",
          });
          yield* recheck(admins.organizationId);
          expect(asked()).toBe(0);
          expect(yield* nextRecheckAt(admins.organizationId)).toBeUndefined();

          // Beside a pause of Relayit's own that SES has since lifted.
          const mixed = yield* seedProject([REGION, REGION]);
          const [automatic = "", byAdmin = ""] = mixed.domainIds;
          yield* pauseCustomDomain({ customDomainId: byAdmin, reason: "bad_reputation" });
          yield* pauseFromRefusedSend(mixed.organizationId);
          yield* recheck(mixed.organizationId);

          expect(yield* pauseOf(automatic)).toEqual(NOT_PAUSED);
          for (const domainId of [byAdmin, admins.domainIds[0] ?? ""]) {
            expect(yield* pauseOf(domainId)).toEqual({
              isPaused: true,
              pausedReason: "bad_reputation",
            });
          }
        }),
      ),
    );

    it.live("is scheduled for every pause of Relayit's own when a worker starts", () =>
      withSes(({ backend }) =>
        Effect.gen(function* () {
          // Paused with nothing scheduled: the schedule was lost, or never written.
          const paused = yield* seedProject([]);
          yield* addDomain(paused.organizationId, REGION, PAUSED_UNSCHEDULED);
          const byAdmin = yield* seedProject();
          yield* pauseCustomDomain({
            customDomainId: byAdmin.domainIds[0] ?? "",
            reason: "bad_reputation",
          });
          const atStart = emailRecheckProjectSendingPauseHandler.reconcile;
          if (!atStart) {
            return yield* Effect.die("the recheck job has nothing to do when a worker starts");
          }

          yield* atStart.pipe(Effect.provideService(EmailBackend, backend));

          expect(yield* nextRecheckAt(paused.organizationId)).toBeGreaterThan(Date.now());
          expect(yield* nextRecheckAt(byAdmin.organizationId)).toBeUndefined();
        }),
      ),
    );

    it.live("lifts a pause found on a Project SES has no tenant for, and ends", () =>
      withSes(({ asked, backend }) =>
        Effect.gen(function* () {
          // A pause that came with a Domain claimed from the Project SES paused, before
          // a claim lifted it: SES has nothing of this Project's to pause in the region.
          const project = yield* seedProject([]);
          const domainId = yield* addDomain(project.organizationId, REGION, PAUSED_UNSCHEDULED);
          const recheckAbsent = recheckJob(project.organizationId).pipe(
            Effect.provideService(EmailBackend, {
              ...backend,
              getProjectSendingStatus: (input) =>
                backend.getProjectSendingStatus(input).pipe(Effect.as("absent" as const)),
            }),
          );

          yield* recheckAbsent;

          expect(yield* pauseOf(domainId)).toEqual(NOT_PAUSED);
          expect(yield* eventsOf(project.organizationId)).toMatchObject([
            { payload: { domain_id: domainId, paused: false }, type: "domain.updated" },
          ]);
          // Nothing is left paused, so the next run asks SES nothing and schedules no other.
          const scheduled = yield* nextRecheckAt(project.organizationId);
          yield* recheckAbsent;
          expect(asked()).toBe(1);
          expect(yield* nextRecheckAt(project.organizationId)).toBe(scheduled);
        }),
      ),
    );

    describe("when SES refuses the status read until an operator acts", () => {
      /**
       * One period of the worker for the recheck job alone: whatever is scheduled or
       * waiting on a retry is due (the clock is a day ahead while promoting) and is run.
       * That includes the rechecks of pauses other tests left, so each test looks only at
       * what names its own Project.
       */
      const workerPeriod = Effect.gen(function* () {
        const redis = yield* Redis;
        yield* redis.createConsumerGroup({ group: JOB_WORKER_GROUP, stream: rechecker.stream });
        yield* Effect.gen(function* () {
          yield* TestClock.setTime(Date.now() + 86_400_000);
          yield* promoteScheduledJobs([rechecker], { limit: 100 });
          yield* promoteDelayedJobs([rechecker], { limit: 100 });
        }).pipe(Effect.provide(TestClock.layer()));
        yield* processJobBatch([rechecker], {
          blockMs: 100,
          concurrency: 1,
          consumer: "test",
          count: 1000,
        });
      });
      /** The warnings logged about one Project while `effect` ran. */
      const warningsAbout = () => {
        const logged: string[] = [];
        return {
          layer: Logger.layer([
            Logger.make(({ logLevel, message }) => {
              if (logLevel === "Warn") {
                logged.push(JSON.stringify(message));
              }
            }),
          ]),
          of: (organizationId: string) => logged.filter((text) => text.includes(organizationId)),
        };
      };
      const deadLettersOf = (organizationId: string) =>
        Effect.gen(function* () {
          const db = yield* DB;
          const all = yield* db
            .select({ failure: jobDeadLetter.failure, payload: jobDeadLetter.payload })
            .from(jobDeadLetter);
          return all.filter(({ payload }) => payload.includes(organizationId));
        });

      it.live.each([
        [
          "credentials lack the ses: read permissions",
          new EmailBackendAuthenticationError({ region: REGION }),
        ],
        [
          "region is no longer in SES_REGIONS",
          new EmailBackendConfigurationError({ code: "unknown_region", region: REGION }),
        ],
      ] as const)(
        "its %s: warns once, dead-letters nothing, and lifts the pause once SES answers",
        ([, refusal]) =>
          withSes(({ backend }) => {
            const warnings = warningsAbout();
            let refused = true;
            return Effect.gen(function* () {
              const project = yield* seedProject([]);
              const domainId = yield* addDomain(project.organizationId, REGION, PAUSED_UNSCHEDULED);
              // SES has restored the Project; Relayit cannot see it yet.
              const atStart = emailRecheckProjectSendingPauseHandler.reconcile;
              if (!atStart) {
                return yield* Effect.die("the recheck job has nothing to do when a worker starts");
              }
              yield* atStart;
              const warned = () => warnings.of(project.organizationId);

              const before = Date.now();
              for (let period = 0; period < 4; period += 1) {
                yield* workerPeriod;
              }

              expect(yield* pauseOf(domainId)).toEqual(PAUSED_BY_RELAYIT);
              expect(yield* deadLettersOf(project.organizationId)).toEqual([]);
              // The operator is told once what to grant, not once a period.
              expect(warned()).toHaveLength(1);
              expect(warned()[0]).toContain("ses:GetReputationEntity");
              // And the next is an hour on, not five minutes.
              expect(yield* nextRecheckAt(project.organizationId)).toBeGreaterThanOrEqual(
                before + 60 * 60_000,
              );

              // The operator fixes it; nothing else prompts the recheck.
              refused = false;
              yield* workerPeriod;

              expect(yield* pauseOf(domainId)).toEqual(NOT_PAUSED);
              expect(yield* eventsOf(project.organizationId)).toMatchObject([
                { payload: { domain_id: domainId, paused: false }, type: "domain.updated" },
              ]);
              expect(warned()).toHaveLength(1);
              expect(yield* deadLettersOf(project.organizationId)).toEqual([]);
            }).pipe(
              Effect.provideService(EmailBackend, {
                ...backend,
                getProjectSendingStatus: (input) =>
                  refused ? Effect.fail(refusal) : backend.getProjectSendingStatus(input),
              }),
              Effect.provide(warnings.layer),
            );
          }),
      );

      it.live("warns again when a worker starts and SES still refuses", () =>
        withSes(({ backend }) => {
          const warnings = warningsAbout();
          return Effect.gen(function* () {
            const project = yield* seedProject([]);
            yield* addDomain(project.organizationId, REGION, PAUSED_UNSCHEDULED);
            const atStart = emailRecheckProjectSendingPauseHandler.reconcile;
            if (!atStart) {
              return yield* Effect.die("the recheck job has nothing to do when a worker starts");
            }

            yield* atStart;
            yield* workerPeriod;
            yield* workerPeriod;
            yield* atStart;
            yield* workerPeriod;
            yield* workerPeriod;

            expect(warnings.of(project.organizationId)).toHaveLength(2);
          }).pipe(
            Effect.provideService(EmailBackend, {
              ...backend,
              getProjectSendingStatus: () =>
                Effect.fail(new EmailBackendAuthenticationError({ region: REGION })),
            }),
            Effect.provide(warnings.layer),
          );
        }),
      );
    });

    describe("a run that fails still leaves the next one scheduled", () => {
      /** A Project paused by Relayit with no recheck scheduled, so any found is the run's. */
      const pausedUnscheduled = Effect.gen(function* () {
        const project = yield* seedProject([]);
        const domainId = yield* addDomain(project.organizationId, REGION, PAUSED_UNSCHEDULED);
        return { ...project, domainId };
      });

      it.live("when SES cannot be asked", () =>
        withSes(({ backend }) =>
          Effect.gen(function* () {
            const project = yield* pausedUnscheduled;

            const exit = yield* recheckJob(project.organizationId).pipe(
              Effect.provideService(EmailBackend, {
                ...backend,
                getProjectSendingStatus: () =>
                  Effect.fail(new EmailBackendUnavailable({ region: REGION })),
              }),
              Effect.exit,
            );

            expect(exit._tag).toBe("Failure");
            expect(yield* nextRecheckAt(project.organizationId)).toBeGreaterThan(Date.now());
            expect(yield* pauseOf(project.domainId)).toEqual(PAUSED_BY_RELAYIT);
          }),
        ),
      );

      it.live("when its first read of the database fails", () =>
        withSes(({ asked, backend }) =>
          Effect.gen(function* () {
            const db = yield* DB;
            const project = yield* pausedUnscheduled;

            const exit = yield* recheckJob(project.organizationId).pipe(
              Effect.provideService(EmailBackend, backend),
              Effect.provideService(
                DB,
                new Proxy(db, {
                  get: (target, property, receiver) =>
                    property === "selectDistinct"
                      ? () => {
                          throw new Error("Postgres is unreachable");
                        }
                      : Reflect.get(target, property, receiver),
                }),
              ),
              Effect.exit,
            );

            expect(exit._tag).toBe("Failure");
            expect(asked()).toBe(0);
            expect(yield* nextRecheckAt(project.organizationId)).toBeGreaterThan(Date.now());
          }),
        ),
      );

      it.live("when Redis refuses the write that schedules it", () =>
        withSes(({ backend }) =>
          Effect.gen(function* () {
            const jobs = yield* Jobs;
            const project = yield* pausedUnscheduled;
            let writes = 0;

            const exit = yield* recheckJob(project.organizationId).pipe(
              Effect.provideService(EmailBackend, backend),
              Effect.provideService(Jobs, {
                ...jobs,
                // The first write fails, as on a connection Redis has just dropped.
                schedule: ((...args: Parameters<typeof jobs.schedule>) => {
                  writes += 1;
                  return writes === 1
                    ? Effect.fail(
                        new JobEnqueueError({
                          cause: "connection reset",
                          jobName: emailRecheckProjectSendingPauseJob.name,
                          stage: "schedule",
                        }),
                      )
                    : jobs.schedule(...args);
                }) as typeof jobs.schedule,
              }),
              Effect.exit,
            );

            expect(exit._tag).toBe("Failure");
            expect(yield* nextRecheckAt(project.organizationId)).toBeGreaterThan(Date.now());
          }),
        ),
      );
    });
  });

  describe("two syncs of one Project at once", () => {
    /** SES answering each read only when the test lets it, in the order the reads began. */
    const orderedSes = Effect.gen(function* () {
      const fake = yield* makeFakeEmailBackend(REGION);
      const reads: {
        readonly answer: Deferred.Deferred<"enabled" | "paused">;
        readonly began: Deferred.Deferred<void>;
      }[] = [];
      for (let read = 0; read < 2; read += 1) {
        reads.push({
          answer: yield* Deferred.make<"enabled" | "paused">(),
          began: yield* Deferred.make<void>(),
        });
      }
      let next = 0;
      return {
        backend: {
          ...fake,
          getProjectSendingStatus: () =>
            Effect.suspend(() => {
              const read = reads[next];
              next += 1;
              return read
                ? Deferred.succeed(read.began, undefined).pipe(
                    Effect.andThen(Deferred.await(read.answer)),
                  )
                : Effect.die("more reads than the test ordered");
            }),
        },
        began: () => next,
        reads,
      };
    });

    it.live("the sync that read the older status never writes after the newer one", () =>
      Effect.gen(function* () {
        const db = yield* DB;
        const project = yield* seedProject();
        const { backend, began, reads } = yield* orderedSes;
        const [older, newer] = reads;
        if (!(older && newer)) {
          return yield* Effect.die("the test orders two reads");
        }
        const sync = syncProjectSendingStatus(db, {
          projectId: project.organizationId,
          region: REGION,
        }).pipe(Effect.provideService(EmailBackend, backend));

        // The first reads while SES still pauses the tenant, and is slow to get its answer.
        const first = yield* Effect.forkChild(sync);
        yield* Deferred.await(older.began);
        // The second starts after SES restored the tenant: it must not read, let alone
        // write, until the first has written.
        const second = yield* Effect.forkChild(sync);
        yield* Effect.sleep("500 millis");
        expect(began()).toBe(1);

        yield* Deferred.succeed(older.answer, "paused");
        yield* Deferred.await(newer.began);
        expect(yield* pauseOf(project.domainIds[0] ?? "")).toEqual(PAUSED_BY_RELAYIT);
        yield* Deferred.succeed(newer.answer, "enabled");
        yield* Fiber.join(first);
        yield* Fiber.join(second);

        expect(yield* pauseOf(project.domainIds[0] ?? "")).toEqual(NOT_PAUSED);
      }).pipe(Effect.scoped, Effect.provide(services)),
    );

    it.live("one that cannot get its turn fails, to be tried again, and writes nothing", () =>
      Effect.gen(function* () {
        const db = yield* DB;
        const project = yield* seedProject();
        const { backend, began, reads } = yield* orderedSes;
        const [stuck] = reads;
        if (!stuck) {
          return yield* Effect.die("the test orders a read");
        }
        const sync = syncProjectSendingStatus(db, {
          projectId: project.organizationId,
          region: REGION,
        }).pipe(Effect.provideService(EmailBackend, backend));

        // SES never answers the first, which holds the Project's turn meanwhile.
        const holder = yield* Effect.forkChild(sync);
        yield* Deferred.await(stuck.began);
        const waiting = yield* Effect.flip(sync);

        expect(waiting).toMatchObject({ _tag: "ProjectSendingPauseError", operation: "lock" });
        expect(began()).toBe(1);
        expect(yield* pauseOf(project.domainIds[0] ?? "")).toEqual(NOT_PAUSED);
        yield* Fiber.interrupt(holder);
      }).pipe(Effect.scoped, Effect.provide(services)),
    );
  });

  describe("a pause or unpause by an admin", () => {
    it.live("tells the Project that holds the Domain once for each change", () =>
      Effect.gen(function* () {
        const project = yield* seedProject();
        const bystander = yield* seedProject();
        const [domainId = ""] = project.domainIds;

        yield* pauseCustomDomain({ customDomainId: domainId, reason: "manual_admin_pause" });
        // Asked again for what it already is: nothing changed.
        yield* pauseCustomDomain({ customDomainId: domainId, reason: "manual_admin_pause" });
        yield* pauseCustomDomain({ customDomainId: domainId, reason: "bad_reputation" });
        yield* unpauseCustomDomain({ customDomainId: domainId });
        yield* unpauseCustomDomain({ customDomainId: domainId });

        const changed = (paused: boolean, paused_reason: string | null) => ({
          payload: { domain_id: domainId, paused, paused_reason, status: "verified" },
          type: "domain.updated",
        });
        expect(yield* eventsOf(project.organizationId)).toEqual([
          changed(true, "manual_admin_pause"),
          changed(true, "bad_reputation"),
          changed(false, null),
        ]);
        expect(yield* eventsOf(bystander.organizationId)).toEqual([]);
        expect(
          yield* Effect.flip(unpauseCustomDomain({ customDomainId: typeid("domn").toString() })),
        ).toMatchObject({ _tag: "CustomDomainNotFound" });
      }).pipe(Effect.provide(services)),
    );

    it.live("takes over a pause of Relayit's own, which SES restoring then leaves alone", () =>
      withSes(({ deliver, setPaused }) =>
        Effect.gen(function* () {
          const project = yield* seedProject();
          const [domainId = ""] = project.domainIds;
          yield* setPaused(project.organizationId, true);
          yield* deliver(eventFor("disabled", project.organizationId));

          // Without unpausing it first.
          yield* pauseCustomDomain({ customDomainId: domainId, reason: "manual_admin_pause" });
          yield* setPaused(project.organizationId, false);
          yield* deliver(eventFor("enabled", project.organizationId));

          expect(yield* pauseOf(domainId)).toEqual({
            isPaused: true,
            pausedReason: "manual_admin_pause",
          });
          expect(yield* eventsOf(project.organizationId)).toMatchObject([
            { payload: { paused: true, paused_reason: "project_sending_pause" } },
            { payload: { paused: true, paused_reason: "manual_admin_pause" } },
          ]);
        }),
      ),
    );
  });

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
          getProjectSendingStatus: () =>
            Effect.fail(new EmailBackendUnavailable({ region: REGION })),
        }),
        Effect.exit,
      );

      expect(error._tag).toBe("Failure");
      expect(yield* pauseOf(project.domainIds[0] ?? "")).toEqual(NOT_PAUSED);
    }).pipe(Effect.scoped, Effect.provide(services)),
  );
});
