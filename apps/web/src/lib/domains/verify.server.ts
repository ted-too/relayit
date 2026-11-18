import {
  verifyCustomDomainOwnership,
  verifyCustomDomainRegistration,
} from "@repo/channels/email/verification";
import { DB } from "@repo/persistence/db/effect";
import { Effect } from "effect";
import { CustomDomainAdminError } from "./custom-domain.server";
import { listCustomDomainsForProject } from "./list.server";

/** Synchronously refresh SES, DNS and ownership verification for the UI. */
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
            with: { registration: true },
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
            }),
        ),
      );

    if (!link?.customDomain) {
      return yield* new CustomDomainAdminError({
        code: "not_found",
        message: "Domain is not linked to this Project.",
      });
    }

    const domain = link.customDomain;
    if (!domain.registration) {
      return yield* new CustomDomainAdminError({
        code: "failed",
        message: "Domain is not registered with SES.",
      });
    }

    yield* verifyCustomDomainRegistration({
      db,
      domain,
      registration: domain.registration,
    }).pipe(
      Effect.mapError(
        (cause) =>
          new CustomDomainAdminError({
            cause,
            code: "failed",
            message: "Failed to refresh Custom Domain verification.",
          }),
      ),
    );

    // A link starts unverified only as a claim on a Domain another Project holds.
    if (link.ownershipVerificationStatus !== "verified") {
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
            }),
        ),
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
