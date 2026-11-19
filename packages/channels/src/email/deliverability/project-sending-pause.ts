import { defineJob, defineJobHandler, Jobs } from "@repo/jobs";
import {
  type Database,
  type DatabaseExecutor,
  type DatabaseTransaction,
  DB,
} from "@repo/persistence/db/effect";
import {
  customDomain,
  emailDomainRegistration,
  organizationDomain,
} from "@repo/persistence/db/schema";
import { emitWebhookEvent } from "@repo/webhooks";
import { domainUpdated } from "@repo/webhooks/events";
import { and, eq, ne, not, type SQL, sql } from "drizzle-orm";
import { Clock, Data, Duration, Effect, Schema } from "effect";
import { EmailBackend, EmailBackendUnavailable } from "../backend";
import { domainChecksStopped } from "../verification/cadence";

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
 * how long that can last when no event says otherwise. Each check is two SES calls, and SES
 * allows one call a second in a region for everything but sending, so a paused Project and
 * region costs 1/150 of that: a tenth of it at 15 paused at once, all of it at 150. A check
 * SES throttles fails and is retried, and the next is scheduled whatever becomes of it.
 */
const RECHECK_EVERY = Duration.minutes(5);

/**
 * How often instead, once SES has refused the status read for a reason only an operator can
 * change: credentials without `ses:GetTenant` or `ses:GetReputationEntity`, or a Domain
 * registered in a region no longer in `SES_REGIONS`. No retry gets past either, so asking
 * every five minutes would only fill the logs and the dead letters; this is how long a pause
 * can outlast the operator's fix. A worker that starts asks at once, whatever is scheduled.
 */
const RECHECK_BLOCKED_EVERY = Duration.hours(1);

/**
 * How far apart a starting worker spreads the rechecks it schedules: each is two calls, so
 * anything under two seconds would by itself ask more of SES than it allows.
 */
const RECHECK_SPREAD = Duration.seconds(3);

/**
 * Asks SES again about one Project in one region for as long as Relayit holds a Domain of
 * its paused for a Project Sending Pause. SES's events are what normally lift the pause, but
 * one can be lost (dropped after SNS's hour of retries, or acknowledged by an api that could
 * not act on it), and the delivery handler pauses from a refusal that SES may have taken back
 * by the time the pause is written; nothing else would ever lift those.
 */
export const emailRecheckProjectSendingPauseJob = defineJob({
  name: "email.recheck-project-sending-pause",
  payload: Schema.Struct({
    /** The run before this one was refused by SES and said so: this one stays quiet. */
    blocked: Schema.optional(Schema.Boolean),
    organizationId: Schema.String,
    region: Schema.String,
  }),
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

/**
 * Takes the rows of Domains a Project holds in a region, in id order, before anything writes
 * them: all of them, or those `among` picks. A pause or its lifting writes several Domains,
 * and several run at once: SES refuses every send of a paused Project together, each from a
 * Domain of its own, and reports the pause to the api besides. An update takes its rows in
 * whatever order it finds them, so each writer takes them here first, in one order, or two
 * wait on each other. The delivery handler takes all of them before its Delivery, the order
 * a removal or a claim transfer takes a Domain and its Deliveries in.
 *
 * `NO KEY UPDATE` is what the update itself takes: it keeps out a removal or transfer, which
 * take the row `FOR UPDATE`, and lets through an accept or an SES notification, which take
 * it `KEY SHARE`. A row another transaction has written and not committed is judged as it
 * was, as an update judges it, so lifting one pause never waits on another being made.
 */
export const lockProjectDomains = (tx: DatabaseTransaction, input: ProjectInRegion, among?: SQL) =>
  tx
    .select({ id: customDomain.id })
    .from(customDomain)
    .where(and(among, heldInRegion(input)))
    .orderBy(customDomain.id)
    .for("no key update")
    .pipe(
      Effect.mapError(
        (cause) =>
          new ProjectSendingPauseError({
            cause,
            operation: "lock",
            organizationId: input.organizationId,
          }),
      ),
    );

/** What `domain.updated` says of a Domain: the columns every writer that emits it returns. */
export const domainUpdatedColumns = {
  id: customDomain.id,
  isPaused: customDomain.isPaused,
  lastCheckedAt: customDomain.lastCheckedAt,
  nextVerifyAt: customDomain.nextVerifyAt,
  pausedReason: customDomain.pausedReason,
  verificationStatus: customDomain.verificationStatus,
};

/**
 * Tells a Project that a Domain it holds was paused or unpaused, whoever did it, or that
 * Relayit stopped checking it because it stayed unverified.
 */
export const emitDomainUpdated = (
  tx: DatabaseTransaction,
  organizationId: string,
  domain: Pick<typeof customDomain.$inferSelect, keyof typeof domainUpdatedColumns>,
) =>
  emitWebhookEvent(tx, {
    event: {
      data: {
        checks_stopped: domainChecksStopped(domain),
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
    const unpaused = not(customDomain.isPaused);
    yield* lockProjectDomains(tx, input, unpaused);
    const paused = yield* tx
      .update(customDomain)
      .set({ isPaused: true, pausedReason: "project_sending_pause" })
      .where(and(unpaused, heldInRegion(input)))
      .returning(domainUpdatedColumns)
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
    yield* scheduleRecheck(
      { organizationId: input.organizationId, region: input.region },
      RECHECK_EVERY,
    );
    return paused.length;
  });

/**
 * Unpauses the Domains `pauseProjectDomains` paused, and only those: a Domain an admin
 * paused, for reputation or anything else, stays paused until an admin unpauses it.
 */
const unpauseProjectDomains = (tx: DatabaseTransaction, input: ProjectInRegion) =>
  Effect.gen(function* () {
    const pausedHere = and(
      customDomain.isPaused,
      eq(customDomain.pausedReason, "project_sending_pause"),
    );
    yield* lockProjectDomains(tx, input, pausedHere);
    const unpaused = yield* tx
      .update(customDomain)
      .set({ isPaused: false, pausedReason: null })
      .where(and(pausedHere, heldInRegion(input)))
      .returning(domainUpdatedColumns)
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
 * Lifts, as a Domain changes holder, a pause made for a Project Sending Pause: that pause is
 * of the Project that held the Domain then, and its recheck looks only at Domains that
 * Project still holds, so nothing else would lift it for the new holder. It stays only when
 * Relayit holds another of the new holder's Domains in the region paused for the same
 * reason: SES pauses that Project there too, and its own recheck lifts both. A pause an admin
 * made is not this one's to lift. The caller holds the Domain's row.
 */
export const liftPreviousHolderPause = (
  tx: DatabaseTransaction,
  input: {
    readonly customDomainId: string;
    readonly defaultRegion: string;
    /** The Project the Domain now belongs to. */
    readonly organizationId: string;
  },
) =>
  Effect.gen(function* () {
    const pausedForProject = and(
      customDomain.isPaused,
      eq(customDomain.pausedReason, "project_sending_pause"),
    );
    const lifted = yield* Effect.gen(function* () {
      const [paused] = yield* tx
        .select({ id: customDomain.id })
        .from(customDomain)
        .where(and(eq(customDomain.id, input.customDomainId), pausedForProject));
      if (!paused) {
        return {};
      }
      const [registration] = yield* tx
        .select({ region: emailDomainRegistration.region })
        .from(emailDomainRegistration)
        .where(eq(emailDomainRegistration.customDomainId, input.customDomainId));
      const region = registration?.region ?? input.defaultRegion;
      const [holdersOwn] = yield* tx
        .select({ id: customDomain.id })
        .from(customDomain)
        .where(
          and(
            ne(customDomain.id, input.customDomainId),
            pausedForProject,
            heldInRegion({
              defaultRegion: input.defaultRegion,
              organizationId: input.organizationId,
              region,
            }),
          ),
        )
        .limit(1);
      if (holdersOwn) {
        return { keptIn: region };
      }
      const [unpaused] = yield* tx
        .update(customDomain)
        .set({ isPaused: false, pausedReason: null })
        .where(and(eq(customDomain.id, input.customDomainId), pausedForProject))
        .returning(domainUpdatedColumns);
      return { unpaused };
    }).pipe(
      Effect.mapError(
        (cause) =>
          new ProjectSendingPauseError({
            cause,
            operation: "unpause_domains",
            organizationId: input.organizationId,
          }),
      ),
    );
    if (lifted.keptIn !== undefined) {
      // The new holder's own pause was read without its lock, so SES may be restoring that
      // Project right now: if its last recheck ran between that unpause and this commit, it
      // found nothing paused and scheduled no other. This one is what lifts the Domain then.
      yield* scheduleRecheck(
        { organizationId: input.organizationId, region: lifted.keptIn },
        RECHECK_EVERY,
      );
      return;
    }
    if (lifted.unpaused) {
      yield* emitDomainUpdated(tx, input.organizationId, lifted.unpaused).pipe(
        Effect.mapError(
          (cause) =>
            new ProjectSendingPauseError({
              cause,
              operation: "emit_webhook",
              organizationId: input.organizationId,
            }),
        ),
      );
    }
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
          // No tenant in this region, so SES has paused nothing of the Project's there, and
          // a pause found on one of its Domains was never its own: it came with a Domain
          // another Project held when SES paused that one.
          case "absent":
            return { domains: yield* unpauseProjectDomains(tx, scope), status };
        }
      }),
    );
  });

/**
 * The Projects and regions that hold a Domain paused for a Project Sending Pause. The reason
 * is compared as text, so a database whose enum does not have the value yet answers nothing
 * rather than failing. A worker asks this as it starts, and its startup check
 * (`requireMigrated`) already holds it back until that migration is applied; this is the
 * second guard, for anything else that asks.
 */
const pausedProjectsInRegions = (
  db: DatabaseExecutor,
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
        sql`${customDomain.pausedReason}::text = 'project_sending_pause'`,
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
  payload: typeof emailRecheckProjectSendingPauseJob.payload.Type,
  after: Duration.Duration,
) =>
  Effect.gen(function* () {
    const jobs = yield* Jobs;
    yield* jobs
      .schedule(
        emailRecheckProjectSendingPauseJob,
        payload,
        (yield* Clock.currentTimeMillis) + Duration.toMillis(after),
      )
      .pipe(
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
 * one would, and never a Domain an admin paused.
 *
 * The rechecks end in one way only: a run that finds nothing of the Project's in the region
 * paused for a Project Sending Pause asks SES nothing and schedules no other. Nothing ever
 * cancels a scheduled run, because a pause that is committing at that moment has just
 * scheduled it and cannot be seen yet. And a run that fails, at any step, schedules the next
 * as it fails, so a database or Redis that is down for one run does not end them.
 *
 * A run SES refuses for its credentials or configuration does not fail: retrying changes
 * nothing, and failing would dead-letter it every period for as long as the pause lasts. It
 * warns the operator, schedules the next an hour on and marks that one `blocked`, so the
 * runs that follow are refused quietly until one is answered. The pause's own schedule and a
 * starting worker's are unmarked, so each of those warns once more if SES still refuses.
 */
export const emailRecheckProjectSendingPauseHandler = defineJobHandler({
  classifyFailure: () => "retryable",
  contract: emailRecheckProjectSendingPauseJob,
  handle: (payload) =>
    Effect.gen(function* () {
      const db = yield* DB;
      const backend = yield* EmailBackend;
      const paused = yield* pausedProjectsInRegions(db, {
        defaultRegion: backend.defaultRegion,
        organizationId: payload.organizationId,
      });
      if (!paused.some((row) => row.region === payload.region)) {
        return;
      }
      const recheck = { organizationId: payload.organizationId, region: payload.region };
      yield* scheduleRecheck(payload, RECHECK_EVERY);
      const synced = yield* syncProjectSendingStatus(db, {
        projectId: payload.organizationId,
        region: payload.region,
      }).pipe(
        Effect.catch((error) => {
          switch (error._tag) {
            case "EmailBackendAuthenticationError":
            case "EmailBackendConfigurationError":
              return Effect.succeed({ refusal: error });
            default:
              return Effect.fail(error);
          }
        }),
      );
      if ("refusal" in synced) {
        yield* scheduleRecheck({ ...recheck, blocked: true }, RECHECK_BLOCKED_EVERY);
        if (!payload.blocked) {
          yield* Effect.logWarning(
            "A Project Sending Pause cannot be rechecked: SES refused to report the Project's sending status. Its Domains stay paused, though SES may have restored the Project, until the SES credentials allow ses:GetTenant and ses:GetReputationEntity on its tenant and the region is in SES_REGIONS. Asking again every hour.",
            { ...recheck, refusal: synced.refusal },
          );
        }
        return;
      }
      if (payload.blocked) {
        yield* scheduleRecheck(recheck, RECHECK_EVERY);
        yield* Effect.logInfo("SES reports the sending status of a paused Project again", recheck);
      }
      if (synced.status !== "paused" && synced.domains > 0) {
        yield* Effect.logInfo("Lifted a Project Sending Pause that SES had already lifted", {
          ...synced,
          ...recheck,
        });
      }
    }).pipe(Effect.tapCause(() => Effect.ignore(scheduleRecheck(payload, RECHECK_EVERY)))),
  // A worker that starts finds every pause a recheck, whatever became of its schedule, spread
  // out so that a restart with many paused Projects does not ask SES about all of them at once.
  reconcile: Effect.gen(function* () {
    const db = yield* DB;
    const backend = yield* EmailBackend;
    const jobs = yield* Jobs;
    const now = yield* Clock.currentTimeMillis;
    const paused = yield* pausedProjectsInRegions(db, { defaultRegion: backend.defaultRegion });
    yield* Effect.forEach(
      paused,
      (payload, index) =>
        jobs
          .schedule(
            emailRecheckProjectSendingPauseJob,
            payload,
            now + (index + 1) * Duration.toMillis(RECHECK_SPREAD),
          )
          .pipe(
            Effect.mapError(
              (cause) =>
                new ProjectSendingPauseError({
                  cause,
                  operation: "schedule_recheck",
                  organizationId: payload.organizationId,
                }),
            ),
          ),
      { discard: true },
    );
  }),
});
