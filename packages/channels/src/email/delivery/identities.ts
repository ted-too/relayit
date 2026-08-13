import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import {
  emailDomainProviderIdentity,
  type Provider,
  type ProviderKind,
  provider,
} from "@repo/persistence/db/schema";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { EmailDeliveryPersistenceError } from "./errors";

export interface RoutableEmailProviderIdentity {
  readonly failoverEligible: boolean;
  readonly failoverPriority: number;
  readonly id: string;
  readonly isActive: boolean;
  readonly provider: Provider;
  readonly verificationStatus: string;
}

export const providerKindFor = (row: {
  readonly scope: string;
}): ProviderKind => (row.scope === "platform" ? "managed" : "byo");

export const listFailoverProviderIdentities = (
  db: DatabaseExecutor,
  input:
    | { readonly customDomainId: string; readonly kind: "custom-domain" }
    | { readonly kind: "sandbox-domain"; readonly sandboxDomainId: string },
  deliveryId: string
) =>
  db
    .select({
      failoverEligible: emailDomainProviderIdentity.failoverEligible,
      failoverPriority: emailDomainProviderIdentity.failoverPriority,
      id: emailDomainProviderIdentity.id,
      isActive: emailDomainProviderIdentity.isActive,
      provider,
      verificationStatus: emailDomainProviderIdentity.verificationStatus,
    })
    .from(emailDomainProviderIdentity)
    .innerJoin(
      provider,
      eq(emailDomainProviderIdentity.providerId, provider.id)
    )
    .where(
      input.kind === "custom-domain"
        ? and(
            eq(
              emailDomainProviderIdentity.customDomainId,
              input.customDomainId
            ),
            eq(emailDomainProviderIdentity.verificationStatus, "verified")
          )
        : and(
            eq(
              emailDomainProviderIdentity.sandboxDomainId,
              input.sandboxDomainId
            ),
            eq(emailDomainProviderIdentity.verificationStatus, "verified")
          )
    )
    .pipe(
      Effect.map((rows) => {
        const routable = rows.map(
          (row) =>
            ({
              failoverEligible: row.failoverEligible,
              failoverPriority: row.failoverPriority,
              id: row.id,
              isActive: row.isActive,
              provider: row.provider,
              verificationStatus: row.verificationStatus,
            }) satisfies RoutableEmailProviderIdentity
        );
        const active = routable.find((identity) => identity.isActive);
        const failover = routable
          .filter(
            (identity) =>
              !identity.isActive &&
              identity.failoverEligible &&
              identity.verificationStatus === "verified"
          )
          .toSorted((a, b) => a.failoverPriority - b.failoverPriority);

        if (!active) {
          return failover;
        }
        return [
          active,
          ...failover.filter((identity) => identity.id !== active.id),
        ];
      }),
      Effect.mapError(
        (cause) =>
          new EmailDeliveryPersistenceError({
            cause,
            deliveryId,
            operation: "load_identities",
          })
      )
    );
