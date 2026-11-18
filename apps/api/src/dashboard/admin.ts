import { pauseCustomDomain, unpauseCustomDomain } from "@repo/channels/email/custom-domain";
import {
  type AdminProject,
  DashboardApi,
  NotFound,
  type OperationFailed,
} from "@repo/contracts/dashboard";
import { DB } from "@repo/persistence/db/effect";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { operationFailed } from "./failures";

/** A pause or unpause that named no Domain is a 404; anything else is ours. */
const pauseFailure =
  (message: string) =>
  (error: {
    readonly _tag: "CustomDomainError" | "CustomDomainNotFound";
  }): Effect.Effect<never, NotFound | OperationFailed> => {
    switch (error._tag) {
      case "CustomDomainNotFound":
        return Effect.fail(new NotFound({ message: "Domain not found." }));
      default:
        return operationFailed(message)(error);
    }
  };

/**
 * The platform admin's operations. `PlatformAdmin` has already refused everyone else, so
 * nothing here is scoped to a Project: these read and change any Project's Domains.
 */
export const adminHandlers = HttpApiBuilder.group(DashboardApi, "admin", (handlers) =>
  Effect.succeed(
    handlers
      .handle("listProjects", () =>
        Effect.gen(function* () {
          const db = yield* DB;
          const projects = yield* db.query.organization
            .findMany({ columns: { id: true, name: true, slug: true }, orderBy: { name: "asc" } })
            .pipe(Effect.catch(operationFailed("Failed to list Projects.")));
          // Held Domains only: a claim is not the claimant's Domain yet.
          const links = yield* db.query.organizationDomain
            .findMany({
              columns: { organizationId: true },
              where: { ownershipVerificationStatus: "verified" },
              with: {
                customDomain: {
                  columns: {
                    fqdn: true,
                    id: true,
                    isPaused: true,
                    pausedReason: true,
                    verificationStatus: true,
                  },
                },
              },
            })
            .pipe(Effect.catch(operationFailed("Failed to list Projects.")));
          const held = Map.groupBy(links, (link) => link.organizationId);
          return projects.map((project): AdminProject => ({
            ...project,
            domains: (held.get(project.id) ?? [])
              .flatMap((link) => (link.customDomain ? [link.customDomain] : []))
              .sort((a, b) => a.fqdn.localeCompare(b.fqdn)),
          }));
        }),
      )
      .handle("pauseDomain", ({ params, payload }) =>
        pauseCustomDomain({ customDomainId: params.domainId, reason: payload.reason }).pipe(
          Effect.catch(pauseFailure("Failed to pause the Domain.")),
          Effect.asVoid,
        ),
      )
      .handle("unpauseDomain", ({ params }) =>
        unpauseCustomDomain({ customDomainId: params.domainId }).pipe(
          Effect.catch(pauseFailure("Failed to unpause the Domain.")),
          Effect.asVoid,
        ),
      ),
  ),
);
