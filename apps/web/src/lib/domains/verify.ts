import {
  verifyCustomDomainOwnership,
  verifyCustomDomainProviderIdentity,
} from "@repo/channels/email/verification";
import { DB } from "@repo/persistence/db/effect";
import { Effect } from "effect";
import { CustomDomainAdminError } from "./custom-domain";
import { listCustomDomainsForProject } from "./list";

const isPendingClaim = (link: {
  ownershipVerificationStatus: string;
  pendingProviderId: string | null;
}) =>
  link.ownershipVerificationStatus !== "verified" ||
  link.pendingProviderId != null;

/** Synchronously refresh provider + ownership verification for UI. */
export const refreshCustomDomainForProject = (input: {
  readonly customDomainId: string;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const db = yield* DB;

    const link = yield* db.query.organizationDomain
      .findFirst({
        where: {
          customDomainId: input.customDomainId,
          organizationId: input.organizationId,
        },
        with: {
          customDomain: {
            with: {
              providerIdentities: {
                with: { provider: true },
              },
            },
          },
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainAdminError({
              cause,
              code: "failed",
              message: "Failed to load Custom Domain for refresh.",
            })
        )
      );

    if (!link?.customDomain) {
      return yield* new CustomDomainAdminError({
        code: "not_found",
        message: "Domain is not linked to this Project.",
      });
    }

    const domain = link.customDomain;
    if (domain.providerIdentities.length === 0) {
      return yield* new CustomDomainAdminError({
        code: "failed",
        message: "Domain has no Provider pairings.",
      });
    }

    for (const identity of domain.providerIdentities) {
      if (!identity.provider) {
        continue;
      }

      yield* verifyCustomDomainProviderIdentity({
        customDomainId: domain.id,
        db,
        fqdn: domain.fqdn,
        identity,
        provider: identity.provider,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainAdminError({
              cause,
              code: "failed",
              message: "Failed to refresh Custom Domain verification.",
            })
        )
      );
    }

    if (isPendingClaim(link)) {
      yield* verifyCustomDomainOwnership({
        customDomain: domain,
        db,
        organizationId: input.organizationId,
      }).pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainAdminError({
              cause,
              code: "failed",
              message: "Failed to refresh ownership verification.",
            })
        )
      );
    }

    const [updated] = yield* listCustomDomainsForProject({
      customDomainId: input.customDomainId,
      organizationId: input.organizationId,
    });

    if (!updated) {
      return yield* new CustomDomainAdminError({
        code: "failed",
        message: "Updated domain not found after refresh.",
      });
    }

    return updated;
  });
