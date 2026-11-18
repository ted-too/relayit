import { defineJob, defineJobHandler, Jobs } from "@repo/jobs";
import { type Database, type DatabaseTransaction, DB } from "@repo/persistence/db/effect";
import {
  customDomain,
  emailDomainRegistration,
  organizationDomain,
} from "@repo/persistence/db/schema";
import { emitWebhookEvent } from "@repo/webhooks";
import { domainUpdated } from "@repo/webhooks/events";
import { and, eq, not, sql } from "drizzle-orm";
import { Clock, Data, Duration, Effect, Schema } from "effect";
import { EmailBackend, EmailBackendUnavailable } from "../backend";

/** Where a Project Sending Pause is: SES keeps a Project's sending status per region. */
interface ProjectInRegion {
  /** Where a registration with no recorded region is. */
  readonly defaultRegion: string;
  readonly organizationId: string;
  readonly region: string;
}

export class ProjectSendingPauseError extends Data.TaggedError("ProjectSendingPauseError")<{
  readonly cause: unknown;
  readonly operation:
    | "emit_webhook"
    | "list_paused"
    | "load_project"
    | "lock"
    | "pause_domains"
    | "schedule_recheck"
    | "unpause_domains";
  readonly organizationId: string;
}> {}

/**
 * SES answers within this or the notification is refused, for SNS to send again: the read
 * runs inside a transaction, which a call that never answers must not hold.
 */
const SENDING_STATUS_TIMEOUT = Duration.seconds(10);

/**
 * How long a sync waits for another of the same Project and region before it gives up, for
 * SNS or the job to try again: a holder stuck on SES must not queue callers behind it, each
 * holding a connection.
 */
const LOCK_WAIT = Duration.seconds(3);

/**
 * How often a Project Sending Pause that Relayit acted on is checked against SES again. A
 * Domain left paused after SES restored the Project refuses every send from it, so this is
 * how long that can last when no event says otherwise; each check is two SES calls for one
 * Project in one region, so even hundreds of paused Projects stay far below one call a second.
 */
const RECHECK_EVERY = Duration.minutes(5);

/**
 * Asks SES again about one Project in one region for as long as Relayit holds a Domain of
 * its paused for a Project Sending Pause. SES's events are what normally lift the pause, but
 * one can be lost (dropped after SNS's hour of retries, or acknowledged by an api that could
 * not act on it), and the delivery handler pauses from a refusal that SES may have taken back
 * by the time the pause is written; nothing else would ever lift those.
 */
export const emailRecheckProjectSendingPauseJob = defineJob({
  name: "email.recheck-project-sending-pause",
  payload: Schema.Struct({ organizationId: Schema.String, region: Schema.String }),
  recurrence: { identity: ({ organizationId, region }) => `${organizationId}:${region}` },
  retry: { backoff: { baseDelayMs: 30_000, maxDelayMs: 5 * 60_000 }, maxAttempts: 3 },
});

/** The Domains a Project holds that send through the region. */
const heldInRegion = ({ defaultRegion, organizationId, region }: ProjectInRegion) =>
  and(
    sql`exists (
      select 1 from ${organizationDomain}
      where ${organizationDomain.customDomainId} = ${customDomain.id}
        and ${organizationDomain.organizationId} = ${organizationId}
        and ${organizationDomain.ownershipVerificationStatus} = 'verified')`,
    sql`exists (
      select 1 from ${emailDomainRegistration}
      where ${emailDomainRegistration.customDomainId} = ${customDomain.id}
        and coalesce(${emailDomainRegistration.region}, ${defaultRegion}) = ${region})`,
  );

/** Tells a Project that a Domain it holds was paused or unpaused, whoever did it. */
export const emitDomainUpdated = (
  tx: DatabaseTransaction,
  organizationId: string,
  domain: Pick<
    typeof customDomain.$inferSelect,
    "id" | "isPaused" | "pausedReason" | "verificationStatus"
  >,
) =>
  emitWebhookEvent(tx, {
    event: {
      data: {
        domain_id: domain.id,
        paused: domain.isPaused,
        paused_reason: domain.pausedReason,
        status: domain.verificationStatus,
      },
      type: domainUpdated.type,
    },
    organizationId,
  });

/**
 * Pauses the Domains a Project holds in a region where SES has paused the Project's sending,
 * and tells the Project of each. A Domain that is already paused is left as it is, whoever
 * paused it and why, so a pause is told once however often it is found, and an admin's pause
 * is never taken for one this would lift again.
 */
export const pauseProjectDomains = (tx: DatabaseTransaction, input: ProjectInRegion) =>
  Effect.gen(function* () {
    const paused = yield* tx
      .update(customDomain)
      .set({ isPaused: true, pausedReason: "project_sending_pause" })
      .where(and(not(customDomain.isPaused), heldInRegion(input)))
      .returning({
        id: customDomain.id,
        isPaused: customDomain.isPaused,
        pausedReason: customDomain.pausedReason,
        verificationStatus: customDomain.verificationStatus,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProjectSendingPauseError({
              cause,
              operation: "pause_domains",
              organizationId: input.organizationId,
            }),
        ),
      );
    if (paused.length === 0) {
      return 0;
    }
    yield* Effect.forEach(paused, (domain) => emitDomainUpdated(tx, input.organizationId, domain), {
      discard: true,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectSendingPauseError({
            cause,
            operation: "emit_webhook",
            organizationId: input.organizationId,
          }),
      ),
    );
    // From here the pause is rechecked until it is lifted. Scheduling is not part of the
    // transaction: a recheck for a pause that rolled back finds nothing paused and stops.
    const jobs = yield* Jobs;
    yield* jobs
      .schedule(
        emailRecheckProjectSendingPauseJob,
        { organizationId: input.organizationId, region: input.region },
        (yield* Clock.currentTimeMillis) + Duration.toMillis(RECHECK_EVERY),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProjectSendingPauseError({
              cause,
              operation: "schedule_recheck",
              organizationId: input.organizationId,
            }),
        ),
      );
    return paused.length;
  });

/**
 * Unpauses the Domains `pauseProjectDomains` paused, and only those: a Domain an admin
 * paused, for reputation or anything else, stays paused until an admin unpauses it.
 */
const unpauseProjectDomains = (tx: DatabaseTransaction, input: ProjectInRegion) =>
  Effect.gen(function* () {
    const unpaused = yield* tx
      .update(customDomain)
      .set({ isPaused: false, pausedReason: null })
      .where(
        and(
          customDomain.isPaused,
          eq(customDomain.pausedReason, "project_sending_pause"),
          heldInRegion(input),
        ),
      )
      .returning({
        id: customDomain.id,
        isPaused: customDomain.isPaused,
        pausedReason: customDomain.pausedReason,
        verificationStatus: customDomain.verificationStatus,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProjectSendingPauseError({
              cause,
              operation: "unpause_domains",
              organizationId: input.organizationId,
            }),
        ),
      );
    yield* Effect.forEach(
      unpaused,
      (domain) => emitDomainUpdated(tx, input.organizationId, domain),
      { discard: true },
    ).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectSendingPauseError({
            cause,
            operation: "emit_webhook",
            organizationId: input.organizationId,
          }),
      ),
    );
    return unpaused.length;
  });

/**
 * Brings a Project's Domains in a region in line with whether SES lets the Project send
 * there. Called when SES reports that the status of the Project's tenant changed, but what
 * it does comes from the status SES answers with now, never from the report: reports arrive
 * late, twice and out of order, so a stale "disabled" for a tenant that is enabled again
 * must pause nothing.
 *
 * `projectId` is whatever a tenant's name gave, so it is looked up before SES is asked
 * anything: a tenant that is not one of this deployment's Projects costs no SES call.
 */
export const syncProjectSendingStatus = (
  db: Database,
  input: { readonly projectId: string; readonly region: string },
) =>
  Effect.gen(function* () {
    const project = yield* db.query.organization
      .findFirst({ columns: { id: true }, where: { id: input.projectId } })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProjectSendingPauseError({
              cause,
              operation: "load_project",
              organizationId: input.projectId,
            }),
        ),
      );
    if (!project) {
      return { domains: 0, status: "unknown_project" } as const;
    }

    const backend = yield* EmailBackend;
    const scope = {
      defaultRegion: backend.defaultRegion,
      organizationId: project.id,
      region: input.region,
    };
    return yield* db.transaction((tx) =>
      Effect.gen(function* () {
        // Read and write as one step per Project and region: of two syncs running at once,
        // the one that read the older status must not be the one that writes last. The wait
        // for the other is bounded, and so is every row lock taken after it.
        yield* tx
          .execute(
            sql`select set_config('lock_timeout', ${String(Duration.toMillis(LOCK_WAIT))}, true),
              pg_advisory_xact_lock(hashtextextended(${`project-sending-status:${project.id}:${input.region}`}, 0))`,
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProjectSendingPauseError({
                  cause,
                  operation: "lock",
                  organizationId: project.id,
                }),
            ),
          );
        const status = yield* backend
          .getProjectSendingStatus({ projectId: project.id, region: input.region })
          .pipe(
            Effect.timeoutOrElse({
              duration: SENDING_STATUS_TIMEOUT,
              orElse: () => Effect.fail(new EmailBackendUnavailable({ region: input.region })),
            }),
          );
        switch (status) {
          case "paused":
            return { domains: yield* pauseProjectDomains(tx, scope), status };
          case "enabled":
            return { domains: yield* unpauseProjectDomains(tx, scope), status };
          default:
            // The Project has no tenant in this region, so SES has paused nothing of its.
            return { domains: 0, status };
        }
      }),
    );
  });

/** The Projects and regions that hold a Domain paused for a Project Sending Pause. */
const pausedProjectsInRegions = (
  db: Database,
  input: { readonly defaultRegion: string; readonly organizationId?: string },
) =>
  db
    .selectDistinct({
      organizationId: organizationDomain.organizationId,
      region: sql<string>`coalesce(${emailDomainRegistration.region}, ${input.defaultRegion})`,
    })
    .from(customDomain)
    .innerJoin(organizationDomain, eq(organizationDomain.customDomainId, customDomain.id))
    .innerJoin(emailDomainRegistration, eq(emailDomainRegistration.customDomainId, customDomain.id))
    .where(
      and(
        customDomain.isPaused,
        eq(customDomain.pausedReason, "project_sending_pause"),
        eq(organizationDomain.ownershipVerificationStatus, "verified"),
        input.organizationId
          ? eq(organizationDomain.organizationId, input.organizationId)
          : undefined,
      ),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new ProjectSendingPauseError({
            cause,
            operation: "list_paused",
            organizationId: input.organizationId ?? "",
          }),
      ),
    );

const scheduleRecheck = (
  payload: { readonly organizationId: string; readonly region: string },
  runAt: number,
) =>
  Effect.gen(function* () {
    const jobs = yield* Jobs;
    yield* jobs.schedule(emailRecheckProjectSendingPauseJob, payload, runAt).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectSendingPauseError({
            cause,
            operation: "schedule_recheck",
            organizationId: payload.organizationId,
          }),
      ),
    );
  });

/**
 * One recheck: the same locked sync an event starts, so it pauses and unpauses exactly as
 * one would, and never a Domain an admin paused. The next recheck is scheduled before SES is
 * asked, so a run that fails, or is dead-lettered, does not end the rechecks; it is dropped
 * only once nothing of the Project's in the region is paused for a Project Sending Pause.
 */
export const emailRecheckProjectSendingPauseHandler = defineJobHandler({
  classifyFailure: () => "retryable",
  contract: emailRecheckProjectSendingPauseJob,
  handle: (payload) =>
    Effect.gen(function* () {
      const db = yield* DB;
      const backend = yield* EmailBackend;
      const jobs = yield* Jobs;
      const stillPaused = pausedProjectsInRegions(db, {
        defaultRegion: backend.defaultRegion,
        organizationId: payload.organizationId,
      }).pipe(Effect.map((rows) => rows.some((row) => row.region === payload.region)));

      // Nothing to recheck (the pause was lifted, or rolled back): no SES call, no next run.
      if (!(yield* stillPaused)) {
        return;
      }
      yield* scheduleRecheck(
        payload,
        (yield* Clock.currentTimeMillis) + Duration.toMillis(RECHECK_EVERY),
      );
      const synced = yield* syncProjectSendingStatus(db, {
        projectId: payload.organizationId,
        region: payload.region,
      });
      if (yield* stillPaused) {
        return;
      }
      yield* jobs.cancel(emailRecheckProjectSendingPauseJob, payload).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectSendingPauseError({
              cause,
              operation: "schedule_recheck",
              organizationId: payload.organizationId,
            }),
        ),
      );
      yield* Effect.logInfo("Lifted a Project Sending Pause that SES had already lifted", {
        ...synced,
        ...payload,
      });
    }),
  // A worker that starts finds every pause a recheck, whatever became of its schedule; they
  // are spread a second apart so a restart with many paused Projects does not ask SES about
  // all of them at once.
  reconcile: Effect.gen(function* () {
    const db = yield* DB;
    const backend = yield* EmailBackend;
    const now = yield* Clock.currentTimeMillis;
    const paused = yield* pausedProjectsInRegions(db, { defaultRegion: backend.defaultRegion });
    yield* Effect.forEach(
      paused,
      (payload, index) => scheduleRecheck(payload, now + (index + 1) * 1000),
      { discard: true },
    );
  }),
});
