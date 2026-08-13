import { DB } from "@repo/persistence/db/effect";
import {
  emailDomainProviderIdentity,
  organization,
  provider,
  sandboxDomain,
} from "@repo/persistence/db/schema";
import { and, count, eq, isNull } from "drizzle-orm";
import { Data, Effect } from "effect";

export class SandboxAllocateError extends Data.TaggedError(
  "SandboxAllocateError"
)<{
  readonly cause?: unknown;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation: "allocate" | "sweep";
  readonly organizationId?: string;
  readonly sandboxDomainId?: string;
}> {}

/**
 * Assign an organization to the least-loaded active verified sandbox root that
 * has ≥1 verified managed (platform) Provider identity. Returns null when none
 * are allocatable.
 */
export const allocateSandboxDomain = (organizationId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;

    const [picked] = yield* db
      .select({ id: sandboxDomain.id })
      .from(sandboxDomain)
      .innerJoin(
        emailDomainProviderIdentity,
        and(
          eq(emailDomainProviderIdentity.sandboxDomainId, sandboxDomain.id),
          eq(emailDomainProviderIdentity.verificationStatus, "verified")
        )
      )
      .innerJoin(
        provider,
        and(
          eq(emailDomainProviderIdentity.providerId, provider.id),
          eq(provider.scope, "platform")
        )
      )
      .leftJoin(
        organization,
        eq(organization.sandboxDomainId, sandboxDomain.id)
      )
      .where(
        and(
          eq(sandboxDomain.isActive, true),
          eq(sandboxDomain.isPaused, false),
          eq(sandboxDomain.verificationStatus, "verified")
        )
      )
      .groupBy(sandboxDomain.id)
      .orderBy(count(organization.id))
      .limit(1)
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxAllocateError({
              cause,
              message: "Failed to pick an allocatable sandbox domain.",
              operation: "allocate",
              organizationId,
            })
        )
      );

    if (!picked) {
      return null;
    }

    yield* db
      .update(organization)
      .set({ sandboxDomainId: picked.id })
      .where(eq(organization.id, organizationId))
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxAllocateError({
              cause,
              message: "Failed to assign organization sandbox domain.",
              operation: "allocate",
              organizationId,
              sandboxDomainId: picked.id,
            })
        )
      );

    return picked.id;
  });

/**
 * Assign every unassigned organization when the given sandbox becomes allocatable.
 */
export const sweepIfSandboxAllocatable = (sandboxDomainId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const row = yield* db.query.sandboxDomain
      .findFirst({
        columns: {
          isActive: true,
          isPaused: true,
          verificationStatus: true,
        },
        where: { id: sandboxDomainId },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxAllocateError({
              cause,
              message: "Failed to load sandbox domain for allocation sweep.",
              operation: "sweep",
              sandboxDomainId,
            })
        )
      );

    if (
      !(row?.isActive && !row.isPaused && row.verificationStatus === "verified")
    ) {
      return 0;
    }

    const unassigned = yield* db
      .select({ id: organization.id })
      .from(organization)
      .where(isNull(organization.sandboxDomainId))
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxAllocateError({
              cause,
              message: "Failed to list organizations without a sandbox.",
              operation: "sweep",
              sandboxDomainId,
            })
        )
      );

    let assigned = 0;
    for (const org of unassigned) {
      const picked = yield* allocateSandboxDomain(org.id).pipe(
        Effect.catchTag("SandboxAllocateError", () => Effect.succeed(null))
      );
      if (!picked) {
        break;
      }
      assigned += 1;
    }

    return assigned;
  });
