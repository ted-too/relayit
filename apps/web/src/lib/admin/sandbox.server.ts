import {
  addSandboxProviderIdentity,
  createSandboxDomain,
  type SandboxDomainError,
} from "@repo/channels/email/sandbox";
import { DB } from "@repo/persistence/db/effect";
import type { Provider, SandboxDomain } from "@repo/persistence/db/schema";
import { Data, Effect } from "effect";

export class SandboxAdminError extends Data.TaggedError("SandboxAdminError")<{
  readonly cause?: unknown;
  readonly code: "not_found" | "unavailable" | "failed";
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
}> {}

export interface CreateSandboxDomainRequest {
  readonly cloudflareZoneId: string | null;
  readonly providerId: string;
  readonly rootDomain: string;
}

export interface AttachSandboxProviderRequest {
  readonly providerId: string;
  readonly sandboxDomainId: string;
}

const mapSandboxDomainError = (cause: SandboxDomainError) => {
  switch (cause.operation) {
    case "unavailable":
      return new SandboxAdminError({
        cause,
        code: "unavailable",
        message: "Sandbox Domains require Cloudflare to be configured.",
      });
    default:
      return new SandboxAdminError({
        cause,
        code: "failed",
        message: "Sandbox Domain operation failed.",
      });
  }
};

const loadPlatformProvider = (providerId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const row = yield* db.query.provider
      .findFirst({
        where: { id: providerId },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxAdminError({
              cause,
              code: "failed",
              message: "Failed to load provider.",
            })
        )
      );

    if (row?.scope !== "platform" || row.channelType !== "email") {
      return yield* new SandboxAdminError({
        code: "not_found",
        message: "Managed email Provider not found.",
      });
    }

    return row satisfies Provider;
  });

const loadSandboxDomain = (sandboxDomainId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const row = yield* db.query.sandboxDomain
      .findFirst({
        where: { id: sandboxDomainId },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxAdminError({
              cause,
              code: "failed",
              message: "Failed to load sandbox domain.",
            })
        )
      );

    if (!row) {
      return yield* new SandboxAdminError({
        code: "not_found",
        message: "Sandbox Domain not found.",
      });
    }

    return row satisfies SandboxDomain;
  });

/**
 * Ops: create a sandbox root under the platform Cloudflare zone and attach the
 * first managed Provider identity.
 */
export const createSandboxDomainForOps = (input: CreateSandboxDomainRequest) =>
  Effect.gen(function* () {
    if (!input.cloudflareZoneId) {
      return yield* new SandboxAdminError({
        code: "unavailable",
        message: "Sandbox Domains require Cloudflare to be configured.",
      });
    }

    const provider = yield* loadPlatformProvider(input.providerId);

    return yield* createSandboxDomain({
      cloudflareZoneId: input.cloudflareZoneId,
      provider,
      rootDomain: input.rootDomain,
    }).pipe(Effect.mapError(mapSandboxDomainError));
  });

/**
 * Ops: attach an additional managed Provider to an existing sandbox root
 * (many↔many).
 */
export const attachSandboxProviderForOps = (
  input: AttachSandboxProviderRequest
) =>
  Effect.gen(function* () {
    const provider = yield* loadPlatformProvider(input.providerId);
    const sandbox = yield* loadSandboxDomain(input.sandboxDomainId);

    return yield* addSandboxProviderIdentity({
      provider,
      sandboxDomain: sandbox,
    }).pipe(Effect.mapError(mapSandboxDomainError));
  });
