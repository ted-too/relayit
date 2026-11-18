import type { Database, DatabaseTransaction } from "@repo/persistence/db/effect";
import {
  customDomain,
  emailDomainRegistration,
  organizationDomain,
} from "@repo/persistence/db/schema";
import { emitWebhookEvent } from "@repo/webhooks";
import { domainUpdated } from "@repo/webhooks/events";
import { and, eq, not, sql } from "drizzle-orm";
import { Data, Duration, Effect } from "effect";
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
    | "load_project"
    | "lock"
    | "pause_domains"
    | "unpause_domains";
  readonly organizationId: string;
}> {}

/**
 * SES answers within this or the notification is refused, for SNS to send again: the read
 * runs inside a transaction, which a call that never answers must not hold.
 */
const SENDING_STATUS_TIMEOUT = Duration.seconds(10);

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

const emitDomainUpdated = (
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
  }).pipe(
    Effect.mapError(
      (cause) => new ProjectSendingPauseError({ cause, operation: "emit_webhook", organizationId }),
    ),
  );

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
    yield* Effect.forEach(paused, (domain) => emitDomainUpdated(tx, input.organizationId, domain), {
      discard: true,
    });
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
        // Read and write as one step per Project and region: of two reports handled at once,
        // the one that read the older status must not be the one that writes last.
        yield* tx
          .execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${`project-sending-status:${project.id}:${input.region}`}, 0))`,
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
