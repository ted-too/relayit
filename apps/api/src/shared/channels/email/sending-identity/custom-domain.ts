import { randomBytes } from "node:crypto";
import type { CustomDomain, Provider } from "@repo/api/db";
import { type DbOrTx, schema } from "@repo/api/db";
import type { TaskContext } from "@repo/api/tasks";
import { createGenericError } from "@repo/api/utils";
import { and, eq, ne } from "drizzle-orm";
import type {
  DomainReadinessResult,
  EmailVendorOps,
  OwnershipResult,
} from "../types";
import { computeNextCheckAt, defaultVerifyCadenceConfig } from "./cadence";
import { detectDnsProvider, verifyOwnershipDns } from "./dns";
import {
  createDomainKeyMaterial,
  deleteProviderIdentity,
  encryptDomainPrivateKey,
  loadDomainKeyMaterial,
  materializeCustomDomainDns,
  registerProviderIdentity,
  teardownDomainIfNoIdentities,
  verifyProviderIdentity,
} from "./identity";

async function createOrganizationDomainLink({
  client,
  organizationId,
  customDomainId,
  ownershipVerified = false,
  pendingProviderId = null,
}: {
  client: DbOrTx;
  organizationId: string;
  customDomainId: string;
  ownershipVerified?: boolean;
  pendingProviderId?: string | null;
}) {
  const token = randomBytes(24).toString("hex");

  await client.insert(schema.organizationDomain).values({
    organizationId,
    customDomainId,
    ownershipToken: token,
    ownershipVerificationStatus: ownershipVerified
      ? "verified"
      : "not_verified",
    pendingProviderId: ownershipVerified ? null : pendingProviderId,
  });

  return { token };
}

export class DomainClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DomainClaimError";
  }
}

/**
 * After ownership verifies on a claim: source loses the Domain; keep only the
 * destination’s chosen Provider pairing (same managed backend ⇒ DNS kept).
 */
async function completeDomainClaimTransfer({
  tx,
  vendor,
  customDomain,
  organizationId,
  keepProviderId,
}: {
  tx: DbOrTx;
  vendor: EmailVendorOps;
  customDomain: CustomDomain;
  organizationId: string;
  keepProviderId: string;
}) {
  await tx
    .delete(schema.organizationDomain)
    .where(
      and(
        eq(schema.organizationDomain.customDomainId, customDomain.id),
        ne(schema.organizationDomain.organizationId, organizationId)
      )
    );

  const identities = await tx.query.emailDomainProviderIdentity.findMany({
    where: (table, { eq: equals }) =>
      equals(table.customDomainId, customDomain.id),
    with: { provider: true },
  });

  for (const identity of identities) {
    if (identity.providerId === keepProviderId) {
      await tx
        .update(schema.emailDomainProviderIdentity)
        .set({
          isActive: true,
          failoverEligible: true,
          failoverPriority: 0,
        })
        .where(eq(schema.emailDomainProviderIdentity.id, identity.id));
      continue;
    }

    await deleteProviderIdentity({
      vendor,
      provider: identity.provider,
      identity,
      fqdn: customDomain.fqdn,
      db: tx,
    });
  }
}

export function createCustomDomainOps(vendor: EmailVendorOps) {
  return {
    async create({
      params: { provider, organizationId, fqdn },
      ctx: { db },
    }: {
      params: { provider: Provider; organizationId: string; fqdn: string };
      ctx: TaskContext;
    }) {
      const { customDomainId } = await db.transaction(async (tx) => {
        const existingDomain = await tx.query.customDomain.findFirst({
          where: (table, { eq }) => eq(table.fqdn, fqdn),
          with: {
            organizations: true,
            providerIdentities: true,
          },
        });

        if (existingDomain) {
          const alreadyLinked = existingDomain.organizations.some(
            (organization) => organization.organizationId === organizationId
          );

          if (alreadyLinked) {
            return { customDomainId: existingDomain.id };
          }

          const verifiedOwner = existingDomain.organizations.find(
            (organization) =>
              organization.ownershipVerificationStatus === "verified"
          );
          const pendingClaim = existingDomain.organizations.find(
            (organization) =>
              organization.ownershipVerificationStatus !== "verified"
          );

          if (verifiedOwner) {
            if (pendingClaim) {
              throw new DomainClaimError(
                "Another Project already has a pending claim on this domain"
              );
            }

            await createOrganizationDomainLink({
              client: tx,
              organizationId,
              customDomainId: existingDomain.id,
              ownershipVerified: false,
              pendingProviderId: provider.id,
            });
          } else {
            // No live owner — treat as free (should be rare); take ownership.
            await createOrganizationDomainLink({
              client: tx,
              organizationId,
              customDomainId: existingDomain.id,
              ownershipVerified: true,
            });
          }

          if (existingDomain.provider === "unknown") {
            const detected = await detectDnsProvider(fqdn);
            if (detected !== "unknown") {
              await tx
                .update(schema.customDomain)
                .set({ provider: detected })
                .where(eq(schema.customDomain.id, existingDomain.id));
            }
          }

          const hasProvider = existingDomain.providerIdentities.some(
            (identity) => identity.providerId === provider.id
          );

          if (!hasProvider) {
            const keyMaterial = await loadDomainKeyMaterial(existingDomain);
            await registerProviderIdentity({
              vendor,
              provider,
              fqdn,
              keyMaterial,
              type: "custom-domain",
              customDomainId: existingDomain.id,
              db: tx,
            });
          }

          return { customDomainId: existingDomain.id };
        }

        const keyMaterial = createDomainKeyMaterial();
        const encryptedPrivateKey = await encryptDomainPrivateKey(
          keyMaterial.dkimPrivateKey
        );

        const [newDomain] = await tx
          .insert(schema.customDomain)
          .values({
            fqdn,
            dkimSelector: keyMaterial.dkimSelector,
            dkimPublicKey: keyMaterial.dkimPublicKey,
            dkimPrivateKey: encryptedPrivateKey,
            verificationStatus: "not_verified",
            provider: await detectDnsProvider(fqdn),
            verifyBackoffLevel: 0,
          })
          .returning();

        await materializeCustomDomainDns({
          client: tx,
          customDomainId: newDomain.id,
          fqdn,
          dkimSelector: keyMaterial.dkimSelector,
          dkimPublicKey: keyMaterial.dkimPublicKey,
        });

        await registerProviderIdentity({
          vendor,
          provider,
          fqdn,
          keyMaterial,
          type: "custom-domain",
          customDomainId: newDomain.id,
          db: tx,
        });

        await createOrganizationDomainLink({
          client: tx,
          organizationId,
          customDomainId: newDomain.id,
          ownershipVerified: true,
        });

        return { customDomainId: newDomain.id };
      });

      return { customDomainId };
    },

    async addProviderIdentity({
      params: { provider, customDomain },
      ctx: { db },
    }: {
      params: { provider: Provider; customDomain: CustomDomain };
      ctx: TaskContext;
    }) {
      const keyMaterial = await loadDomainKeyMaterial(customDomain);

      const identity = await registerProviderIdentity({
        vendor,
        provider,
        fqdn: customDomain.fqdn,
        keyMaterial,
        type: "custom-domain",
        customDomainId: customDomain.id,
        db,
      });

      return { identityId: identity.id };
    },

    async removeProviderIdentity({
      params: { provider, customDomain },
      ctx: { db },
    }: {
      params: { provider: Provider; customDomain: CustomDomain };
      ctx: TaskContext;
    }) {
      const identity = await db.query.emailDomainProviderIdentity.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.customDomainId, customDomain.id),
            eq(table.providerId, provider.id)
          ),
      });

      if (!identity) {
        return { removed: false };
      }

      await deleteProviderIdentity({
        vendor,
        provider,
        identity,
        fqdn: customDomain.fqdn,
        db,
      });

      return { removed: true };
    },

    async checkReadiness({
      params: { customDomain },
      ctx: { db },
    }: {
      params: { customDomain: CustomDomain };
      ctx: TaskContext;
    }) {
      const identities = await db.query.emailDomainProviderIdentity.findMany({
        where: (table, { eq }) => eq(table.customDomainId, customDomain.id),
        with: { provider: true },
      });

      let lastResult: DomainReadinessResult | null = null;

      for (const identity of identities) {
        lastResult = await db.transaction((tx) =>
          verifyProviderIdentity({
            client: tx,
            vendor,
            provider: identity.provider,
            identity,
            fqdn: customDomain.fqdn,
            type: "custom-domain",
            customDomainId: customDomain.id,
          })
        );
      }

      if (!lastResult) {
        return {
          type: "custom-domain" as const,
          customDomainId: customDomain.id,
          verificationStatus: "not_verified" as const,
          nextCheckAt: null,
          activeRecords: 0,
          missingRecords: 0,
        };
      }

      return {
        ...lastResult,
        type: "custom-domain" as const,
        customDomainId: customDomain.id,
      };
    },

    async checkOwnership({
      params: { customDomain, organizationId },
      ctx: { db },
    }: {
      params: { customDomain: CustomDomain; organizationId: string };
      ctx: TaskContext;
    }) {
      return await db.transaction(async (tx) => {
        const link = await tx.query.organizationDomain.findFirst({
          where: (table, { eq, and }) =>
            and(
              eq(table.organizationId, organizationId),
              eq(table.customDomainId, customDomain.id)
            ),
        });

        if (!link) {
          throw new Error(
            `Organization ${organizationId} is not linked to domain ${customDomain.id}`
          );
        }

        const ownershipVerified = await verifyOwnershipDns(
          customDomain.fqdn,
          link.ownershipToken
        );

        const ownershipVerificationStatus = ownershipVerified
          ? "verified"
          : "not_verified";

        const now = new Date();
        const { nextCheckAt: nextVerifyAt, backoffLevel: verifyBackoffLevel } =
          computeNextCheckAt({
            verificationStatus: ownershipVerified ? "verified" : "not_verified",
            backoffLevel: link.ownershipBackoffLevel,
            config: defaultVerifyCadenceConfig,
            from: now,
          });

        await tx
          .update(schema.organizationDomain)
          .set({
            ownershipVerificationStatus,
            ownershipLastCheckedAt: now,
            ownershipNextVerifyAt: nextVerifyAt,
            ownershipBackoffLevel: verifyBackoffLevel,
            ownershipEverVerifiedAt:
              ownershipVerified && !link.ownershipEverVerifiedAt
                ? now
                : link.ownershipEverVerifiedAt,
            pendingProviderId: ownershipVerified
              ? null
              : link.pendingProviderId,
          })
          .where(
            and(
              eq(schema.organizationDomain.organizationId, organizationId),
              eq(schema.organizationDomain.customDomainId, customDomain.id)
            )
          );

        if (ownershipVerified && link.pendingProviderId) {
          await completeDomainClaimTransfer({
            tx,
            vendor,
            customDomain,
            organizationId,
            keepProviderId: link.pendingProviderId,
          });
        }

        return {
          customDomainId: customDomain.id,
          organizationId,
          ownershipVerificationStatus,
          nextCheckAt: nextVerifyAt,
        } satisfies OwnershipResult;
      });
    },

    async delete({
      params: { organizationId, customDomain },
      ctx: { db },
    }: {
      params: {
        provider: Provider;
        organizationId: string;
        customDomain: CustomDomain;
      };
      ctx: TaskContext;
    }) {
      try {
        const deleted = await db.transaction(async (tx) => {
          const domainRow = await tx.query.customDomain.findFirst({
            where: (table, { eq }) => eq(table.id, customDomain.id),
            with: {
              organizations: true,
            },
          });

          if (!domainRow) {
            return { deleted: false as const };
          }

          await tx
            .delete(schema.organizationDomain)
            .where(
              and(
                eq(schema.organizationDomain.organizationId, organizationId),
                eq(schema.organizationDomain.customDomainId, customDomain.id)
              )
            );

          const remainingRefs = domainRow.organizations.filter(
            (organization) => organization.organizationId !== organizationId
          ).length;

          if (remainingRefs > 0) {
            return { deleted: false as const };
          }

          const identities =
            await tx.query.emailDomainProviderIdentity.findMany({
              where: (table, { eq }) =>
                eq(table.customDomainId, customDomain.id),
            });

          for (const identity of identities) {
            const identityProvider = await tx.query.provider.findFirst({
              where: (table, { eq }) => eq(table.id, identity.providerId),
            });

            if (!identityProvider) {
              continue;
            }

            await vendor.deleteIdentity({
              credentials: identityProvider.credentials,
              fqdn: domainRow.fqdn,
            });

            await tx
              .delete(schema.emailDomainProviderIdentity)
              .where(eq(schema.emailDomainProviderIdentity.id, identity.id));
          }

          await teardownDomainIfNoIdentities({
            db: tx,
            type: "custom-domain",
            customDomain: domainRow,
          });

          return { deleted: true as const };
        });

        return { data: deleted, error: null };
      } catch (error) {
        return {
          data: null,
          error: createGenericError("Failed to delete domain", error as Error),
        };
      }
    },
  };
}
