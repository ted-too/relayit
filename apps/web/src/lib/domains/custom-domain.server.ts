import {
  createCustomDomain,
  deleteCustomDomain,
  pauseCustomDomain,
  unpauseCustomDomain,
} from "@repo/channels/email/custom-domain";
import { DB } from "@repo/persistence/db/effect";
import type { Provider } from "@repo/persistence/db/schema";
import { Data, Effect } from "effect";
import { listCustomDomainsForProject } from "./list.server";
import { resolveDefaultManagedEmailProviderId } from "./providers.server";

export class CustomDomainAdminError extends Data.TaggedError(
  "CustomDomainAdminError"
)<{
  readonly cause?: unknown;
  readonly code: "not_found" | "failed" | "claim_conflict";
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
}> {}

const mapLifecycleError = (cause: {
  readonly _tag: string;
  readonly message: string;
  readonly operation?: string;
}) => {
  switch (cause._tag) {
    case "CustomDomainError":
      switch (cause.operation) {
        case "claim":
          return new CustomDomainAdminError({
            cause,
            code: "claim_conflict",
            message: cause.message,
          });
        case "persist":
          if (cause.message === "Domain is not linked to this Project.") {
            return new CustomDomainAdminError({
              cause,
              code: "not_found",
              message: cause.message,
            });
          }
          break;
        default:
          break;
      }
      return new CustomDomainAdminError({
        cause,
        code: "failed",
        message: "Custom Domain operation failed.",
      });
    default:
      return new CustomDomainAdminError({
        cause,
        code: "failed",
        message: "Custom Domain operation failed.",
      });
  }
};

const loadProviderForOrg = (input: {
  readonly organizationId: string;
  readonly providerId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const row = yield* db.query.provider
      .findFirst({
        where: { id: input.providerId },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainAdminError({
              cause,
              code: "failed",
              message: "Failed to load provider.",
            })
        )
      );

    if (row?.channelType !== "email") {
      return yield* new CustomDomainAdminError({
        code: "not_found",
        message: "Email Provider not found.",
      });
    }

    if (
      row.scope === "project" &&
      row.organizationId !== input.organizationId
    ) {
      return yield* new CustomDomainAdminError({
        code: "not_found",
        message: "Email Provider not found.",
      });
    }

    if (row.scope !== "platform" && row.scope !== "project") {
      return yield* new CustomDomainAdminError({
        code: "not_found",
        message: "Email Provider not found.",
      });
    }

    return row satisfies Provider;
  });

const resolveEmailProvider = (input: {
  readonly organizationId: string;
  readonly providerId?: string;
}) =>
  Effect.gen(function* () {
    if (input.providerId) {
      return yield* loadProviderForOrg({
        organizationId: input.organizationId,
        providerId: input.providerId,
      });
    }

    const defaultId = yield* resolveDefaultManagedEmailProviderId;
    if (!defaultId) {
      return yield* new CustomDomainAdminError({
        code: "not_found",
        message: "No default managed email Provider is configured.",
      });
    }

    return yield* loadProviderForOrg({
      organizationId: input.organizationId,
      providerId: defaultId,
    });
  });

export const createCustomDomainForProject = (input: {
  readonly fqdn: string;
  readonly organizationId: string;
  readonly providerId?: string;
}) =>
  Effect.gen(function* () {
    const provider = yield* resolveEmailProvider({
      organizationId: input.organizationId,
      providerId: input.providerId,
    });

    const created = yield* createCustomDomain({
      fqdn: input.fqdn,
      organizationId: input.organizationId,
      provider,
    }).pipe(Effect.mapError(mapLifecycleError));

    const [domain] = yield* listCustomDomainsForProject({
      customDomainId: created.customDomainId,
      organizationId: input.organizationId,
    });

    if (!domain) {
      return yield* new CustomDomainAdminError({
        code: "failed",
        message: "Custom Domain not found after create.",
      });
    }

    return domain;
  });

export const pauseCustomDomainForProject = (input: {
  readonly customDomainId: string;
  readonly organizationId: string;
  readonly reason: "bad_reputation" | "manual_admin_pause";
}) => pauseCustomDomain(input).pipe(Effect.mapError(mapLifecycleError));

export const unpauseCustomDomainForProject = (input: {
  readonly customDomainId: string;
  readonly organizationId: string;
}) => unpauseCustomDomain(input).pipe(Effect.mapError(mapLifecycleError));

export const deleteCustomDomainForProject = (input: {
  readonly customDomainId: string;
  readonly organizationId: string;
}) => deleteCustomDomain(input).pipe(Effect.mapError(mapLifecycleError));
