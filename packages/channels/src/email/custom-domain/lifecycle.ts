import { Jobs } from "@repo/jobs";
import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { type DatabaseExecutor, DB } from "@repo/persistence/db/effect";
import {
  type CustomDomain,
  customDomain,
  type DomainPausedReason,
  emailDnsRecord,
  emailDomainProviderIdentity,
  organizationDomain,
  type Provider,
} from "@repo/persistence/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { Data, Effect } from "effect";
import { makeProviderTypeId } from "../../provider-type";
import type { DomainKeyMaterial } from "../dkim";
import { createDomainKeyMaterial } from "../dkim";
import { EmailManagedDns } from "../managed-dns";
import { EmailProviderRegistry } from "../provider-registry";
import {
  emailVerifyCustomDomainJob,
  emailVerifyOwnershipJob,
  emailVerifyProviderIdentityJob,
} from "../verification/jobs";
import {
  buildCustomDomainRootDnsRecords,
  createOwnershipToken,
  customDomainIdentityDnsOwner,
  customDomainRootDnsOwner,
  resolveCustomDomainMailFromRecords,
} from "./dns";
import { detectDnsProvider } from "./provider-detection";

export class CustomDomainError extends Data.TaggedError("CustomDomainError")<{
  readonly cause?: unknown;
  readonly customDomainId?: string;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation:
    | "claim"
    | "create"
    | "delete"
    | "encrypt_key"
    | "load_key"
    | "pause"
    | "persist"
    | "provider"
    | "register_identity"
    | "schedule"
    | "unpause";
  readonly organizationId?: string;
  readonly providerId?: string;
}> {}

export interface CreateCustomDomainInput {
  readonly fqdn: string;
  readonly organizationId: string;
  readonly provider: Provider;
}

export interface PauseCustomDomainInput {
  readonly customDomainId: string;
  readonly organizationId: string;
  readonly reason: DomainPausedReason;
}

export interface UnpauseCustomDomainInput {
  readonly customDomainId: string;
  readonly organizationId: string;
}

export interface DeleteCustomDomainInput {
  readonly customDomainId: string;
  readonly organizationId: string;
}

const loadCustomDomainKeyMaterial = (domain: CustomDomain) =>
  Effect.gen(function* () {
    const crypto = yield* SymmetricCrypto;
    const dkimPrivateKey = yield* crypto.decrypt(domain.dkimPrivateKey).pipe(
      Effect.mapError(
        (cause) =>
          new CustomDomainError({
            cause,
            customDomainId: domain.id,
            message: "Failed to decrypt custom domain DKIM private key.",
            operation: "load_key",
          })
      )
    );

    return {
      dkimPrivateKey,
      dkimPublicKey: domain.dkimPublicKey,
      dkimSelector: domain.dkimSelector,
    } satisfies DomainKeyMaterial;
  });

const assertOrgDomainLink = (input: {
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
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to load organization domain link.",
              operation: "persist",
              organizationId: input.organizationId,
            })
        )
      );

    if (!link) {
      return yield* new CustomDomainError({
        customDomainId: input.customDomainId,
        message: "Domain is not linked to this Project.",
        operation: "persist",
        organizationId: input.organizationId,
      });
    }

    return link;
  });

const registerCustomDomainProviderIdentity = (input: {
  readonly customDomainId: string;
  readonly db: DatabaseExecutor;
  readonly fqdn: string;
  readonly keyMaterial: DomainKeyMaterial;
  readonly provider: Provider;
}) =>
  Effect.gen(function* () {
    const credentialsVault = yield* ProviderCredentialsVault;
    const providers = yield* EmailProviderRegistry;
    const managedDns = yield* EmailManagedDns;

    const factory = yield* providers
      .get(
        makeProviderTypeId(input.provider.vendorId, input.provider.productId)
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Email provider type is not registered.",
              operation: "provider",
              providerId: input.provider.id,
            })
        )
      );

    const credentials = yield* credentialsVault
      .open(input.provider.credentials)
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to open provider credentials.",
              operation: "provider",
              providerId: input.provider.id,
            })
        )
      );

    const adapter = yield* factory
      .create({
        credentials,
        providerId: input.provider.id,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to create email provider adapter.",
              operation: "provider",
              providerId: input.provider.id,
            })
        )
      );

    const identityResult = yield* adapter
      .createIdentity({
        dkimPrivateKey: input.keyMaterial.dkimPrivateKey,
        dkimSelector: input.keyMaterial.dkimSelector,
        fqdn: input.fqdn,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to create provider sending identity.",
              operation: "register_identity",
              providerId: input.provider.id,
            })
        )
      );

    yield* managedDns
      .reconcile({
        customDomainId: input.customDomainId,
        owner: customDomainIdentityDnsOwner(
          input.customDomainId,
          input.provider.id
        ),
        records: resolveCustomDomainMailFromRecords({
          records: identityResult.mailFrom.records,
        }),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to materialize custom domain MAIL FROM DNS.",
              operation: "register_identity",
              providerId: input.provider.id,
            })
        )
      );

    const existing = yield* input.db.query.emailDomainProviderIdentity
      .findMany({
        columns: {
          failoverPriority: true,
          isActive: true,
        },
        where: { customDomainId: input.customDomainId },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to list custom domain provider identities.",
              operation: "persist",
              providerId: input.provider.id,
            })
        )
      );

    const hasActive = existing.some((row) => row.isActive);
    const maxPriority = existing.reduce(
      (max, row) => Math.max(max, row.failoverPriority),
      0
    );

    const [identity] = yield* input.db
      .insert(emailDomainProviderIdentity)
      .values({
        customDomainId: input.customDomainId,
        failoverEligible: true,
        failoverPriority: hasActive ? maxPriority + 1 : 0,
        isActive: !hasActive,
        providerData: identityResult.providerData,
        providerId: input.provider.id,
        sandboxDomainId: null,
        verificationStatus: "not_verified",
        verifyBackoffLevel: 0,
      })
      .returning()
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to insert custom domain provider identity.",
              operation: "persist",
              providerId: input.provider.id,
            })
        )
      );

    if (!identity) {
      return yield* new CustomDomainError({
        customDomainId: input.customDomainId,
        message: "Failed to insert custom domain provider identity.",
        operation: "persist",
        providerId: input.provider.id,
      });
    }

    return identity;
  });

const scheduleCustomDomainVerification = (input: {
  readonly customDomainId: string;
  readonly identityId: string;
  readonly ownership?: {
    readonly organizationId: string;
  };
}) =>
  Effect.gen(function* () {
    const jobs = yield* Jobs;
    const runAt = Date.now();

    yield* jobs
      .schedule(
        emailVerifyCustomDomainJob,
        { customDomainId: input.customDomainId },
        runAt
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to schedule custom domain verification job.",
              operation: "schedule",
            })
        )
      );

    yield* jobs
      .schedule(
        emailVerifyProviderIdentityJob,
        { identityId: input.identityId },
        runAt
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to schedule identity verification job.",
              operation: "schedule",
            })
        )
      );

    if (input.ownership) {
      yield* jobs
        .schedule(
          emailVerifyOwnershipJob,
          {
            customDomainId: input.customDomainId,
            organizationId: input.ownership.organizationId,
          },
          runAt
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new CustomDomainError({
                cause,
                customDomainId: input.customDomainId,
                message: "Failed to schedule ownership verification job.",
                operation: "schedule",
                organizationId: input.ownership?.organizationId,
              })
          )
        );
    }
  });

const createOrgDomainLink = (input: {
  readonly customDomainId: string;
  readonly db: DatabaseExecutor;
  readonly organizationId: string;
  readonly ownershipVerified: boolean;
  readonly pendingProviderId?: string | null;
}) =>
  Effect.gen(function* () {
    const token = createOwnershipToken();

    yield* input.db
      .insert(organizationDomain)
      .values({
        customDomainId: input.customDomainId,
        organizationId: input.organizationId,
        ownershipToken: token,
        ownershipVerificationStatus: input.ownershipVerified
          ? "verified"
          : "not_verified",
        pendingProviderId: input.ownershipVerified
          ? null
          : (input.pendingProviderId ?? null),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to link Project to custom domain.",
              operation: "persist",
              organizationId: input.organizationId,
            })
        )
      );

    return { token };
  });

/**
 * Create or claim a Project Custom Domain. Customer publishes DNS (no CF
 * auto-manage). New FQDNs become owned immediately; held FQDNs enter a claim.
 */
export const createCustomDomain = (input: CreateCustomDomainInput) =>
  Effect.gen(function* () {
    const db = yield* DB;

    const existing = yield* db.query.customDomain
      .findFirst({
        where: { fqdn: input.fqdn },
        with: {
          organizations: true,
          providerIdentities: true,
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              message: "Failed to look up custom domain by FQDN.",
              operation: "persist",
              organizationId: input.organizationId,
              providerId: input.provider.id,
            })
        )
      );

    if (existing) {
      const alreadyLinked = existing.organizations.some(
        (organization) => organization.organizationId === input.organizationId
      );
      if (alreadyLinked) {
        return { customDomainId: existing.id, kind: "existing" as const };
      }

      if (existing.provider === "unknown") {
        const detected = yield* Effect.tryPromise({
          catch: (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: existing.id,
              message: "Failed to detect custom domain DNS host.",
              operation: "persist",
              organizationId: input.organizationId,
            }),
          try: () => detectDnsProvider(existing.fqdn),
        });

        if (detected !== "unknown") {
          yield* db
            .update(customDomain)
            .set({ provider: detected })
            .where(eq(customDomain.id, existing.id))
            .pipe(
              Effect.mapError(
                (cause) =>
                  new CustomDomainError({
                    cause,
                    customDomainId: existing.id,
                    message: "Failed to persist detected DNS host.",
                    operation: "persist",
                    organizationId: input.organizationId,
                  })
              )
            );
        }
      }

      const verifiedOwner = existing.organizations.find(
        (organization) =>
          organization.ownershipVerificationStatus === "verified"
      );
      const pendingClaim = existing.organizations.find(
        (organization) =>
          organization.ownershipVerificationStatus !== "verified"
      );

      if (verifiedOwner) {
        if (pendingClaim) {
          return yield* new CustomDomainError({
            customDomainId: existing.id,
            message:
              "Another Project already has a pending claim on this domain.",
            operation: "claim",
            organizationId: input.organizationId,
          });
        }

        yield* createOrgDomainLink({
          customDomainId: existing.id,
          db,
          organizationId: input.organizationId,
          ownershipVerified: false,
          pendingProviderId: input.provider.id,
        });

        const hasProvider = existing.providerIdentities.some(
          (identity) => identity.providerId === input.provider.id
        );

        let identityId: string | undefined;
        if (hasProvider) {
          identityId = existing.providerIdentities.find(
            (identity) => identity.providerId === input.provider.id
          )?.id;
        } else {
          const keyMaterial = yield* loadCustomDomainKeyMaterial(existing);
          const identity = yield* registerCustomDomainProviderIdentity({
            customDomainId: existing.id,
            db,
            fqdn: existing.fqdn,
            keyMaterial,
            provider: input.provider,
          });
          identityId = identity.id;
        }

        if (identityId) {
          yield* scheduleCustomDomainVerification({
            customDomainId: existing.id,
            identityId,
            ownership: { organizationId: input.organizationId },
          });
        }

        return { customDomainId: existing.id, kind: "claim" as const };
      }

      yield* createOrgDomainLink({
        customDomainId: existing.id,
        db,
        organizationId: input.organizationId,
        ownershipVerified: true,
      });

      return { customDomainId: existing.id, kind: "existing" as const };
    }

    const managedDns = yield* EmailManagedDns;
    const crypto = yield* SymmetricCrypto;
    const keyMaterial = createDomainKeyMaterial();
    const encryptedPrivateKey = yield* crypto
      .encrypt(keyMaterial.dkimPrivateKey)
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              message: "Failed to encrypt custom domain DKIM private key.",
              operation: "encrypt_key",
              organizationId: input.organizationId,
              providerId: input.provider.id,
            })
        )
      );

    const detectedProvider = yield* Effect.tryPromise({
      catch: (cause) =>
        new CustomDomainError({
          cause,
          message: "Failed to detect custom domain DNS host.",
          operation: "create",
          organizationId: input.organizationId,
          providerId: input.provider.id,
        }),
      try: () => detectDnsProvider(input.fqdn),
    });

    const [row] = yield* db
      .insert(customDomain)
      .values({
        dkimPrivateKey: encryptedPrivateKey,
        dkimPublicKey: keyMaterial.dkimPublicKey,
        dkimSelector: keyMaterial.dkimSelector,
        fqdn: input.fqdn,
        provider: detectedProvider,
        verificationStatus: "not_verified",
        verifyBackoffLevel: 0,
      })
      .returning()
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              message: "Failed to insert custom domain.",
              operation: "persist",
              organizationId: input.organizationId,
              providerId: input.provider.id,
            })
        )
      );

    if (!row) {
      return yield* new CustomDomainError({
        message: "Failed to insert custom domain.",
        operation: "persist",
        organizationId: input.organizationId,
        providerId: input.provider.id,
      });
    }

    yield* managedDns
      .reconcile({
        customDomainId: row.id,
        owner: customDomainRootDnsOwner(row.id),
        records: buildCustomDomainRootDnsRecords({
          dkimPublicKey: keyMaterial.dkimPublicKey,
          dkimSelector: keyMaterial.dkimSelector,
          fqdn: input.fqdn,
        }),
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: row.id,
              message: "Failed to materialize custom domain root DNS.",
              operation: "create",
              providerId: input.provider.id,
            })
        )
      );

    const identity = yield* registerCustomDomainProviderIdentity({
      customDomainId: row.id,
      db,
      fqdn: input.fqdn,
      keyMaterial,
      provider: input.provider,
    });

    yield* createOrgDomainLink({
      customDomainId: row.id,
      db,
      organizationId: input.organizationId,
      ownershipVerified: true,
    });

    yield* scheduleCustomDomainVerification({
      customDomainId: row.id,
      identityId: identity.id,
    });

    return { customDomainId: row.id, kind: "created" as const };
  });

export const pauseCustomDomain = (input: PauseCustomDomainInput) =>
  Effect.gen(function* () {
    yield* assertOrgDomainLink(input);
    const db = yield* DB;

    yield* db
      .update(customDomain)
      .set({
        isPaused: true,
        pausedReason: input.reason,
      })
      .where(eq(customDomain.id, input.customDomainId))
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to pause custom domain.",
              operation: "pause",
              organizationId: input.organizationId,
            })
        )
      );

    return { customDomainId: input.customDomainId, isPaused: true as const };
  });

export const unpauseCustomDomain = (input: UnpauseCustomDomainInput) =>
  Effect.gen(function* () {
    yield* assertOrgDomainLink(input);
    const db = yield* DB;

    yield* db
      .update(customDomain)
      .set({
        isPaused: false,
        pausedReason: null,
      })
      .where(eq(customDomain.id, input.customDomainId))
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to unpause custom domain.",
              operation: "unpause",
              organizationId: input.organizationId,
            })
        )
      );

    return { customDomainId: input.customDomainId, isPaused: false as const };
  });

/**
 * After ownership verifies on a claim: source loses the Domain; keep only the
 * destination’s chosen Provider pairing.
 */
export const completeDomainClaimTransfer = (input: {
  readonly customDomain: CustomDomain;
  readonly db: DatabaseExecutor;
  readonly keepProviderId: string;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    yield* input.db
      .delete(organizationDomain)
      .where(
        and(
          eq(organizationDomain.customDomainId, input.customDomain.id),
          ne(organizationDomain.organizationId, input.organizationId)
        )
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomain.id,
              message: "Failed to remove source Project domain link.",
              operation: "claim",
              organizationId: input.organizationId,
            })
        )
      );

    const identities = yield* input.db.query.emailDomainProviderIdentity
      .findMany({
        where: { customDomainId: input.customDomain.id },
        with: { provider: true },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomain.id,
              message: "Failed to list identities for claim transfer.",
              operation: "claim",
              organizationId: input.organizationId,
            })
        )
      );

    const credentialsVault = yield* ProviderCredentialsVault;
    const providers = yield* EmailProviderRegistry;
    const managedDns = yield* EmailManagedDns;

    for (const identity of identities) {
      if (!identity.provider) {
        continue;
      }

      if (identity.providerId === input.keepProviderId) {
        yield* input.db
          .update(emailDomainProviderIdentity)
          .set({
            failoverEligible: true,
            failoverPriority: 0,
            isActive: true,
          })
          .where(eq(emailDomainProviderIdentity.id, identity.id))
          .pipe(
            Effect.mapError(
              (cause) =>
                new CustomDomainError({
                  cause,
                  customDomainId: input.customDomain.id,
                  message: "Failed to activate kept Provider identity.",
                  operation: "claim",
                  providerId: identity.providerId,
                })
            )
          );
        continue;
      }

      const factory = yield* providers
        .get(
          makeProviderTypeId(
            identity.provider.vendorId,
            identity.provider.productId
          )
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new CustomDomainError({
                cause,
                customDomainId: input.customDomain.id,
                message: "Email provider type is not registered.",
                operation: "provider",
                providerId: identity.providerId,
              })
          )
        );

      const credentials = yield* credentialsVault
        .open(identity.provider.credentials)
        .pipe(
          Effect.mapError(
            (cause) =>
              new CustomDomainError({
                cause,
                customDomainId: input.customDomain.id,
                message: "Failed to open provider credentials.",
                operation: "provider",
                providerId: identity.providerId,
              })
          )
        );

      const adapter = yield* factory
        .create({
          credentials,
          providerId: identity.provider.id,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new CustomDomainError({
                cause,
                customDomainId: input.customDomain.id,
                message: "Failed to create email provider adapter.",
                operation: "provider",
                providerId: identity.providerId,
              })
          )
        );

      yield* adapter.deleteIdentity({ fqdn: input.customDomain.fqdn }).pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomain.id,
              message: "Failed to delete provider identity during claim.",
              operation: "claim",
              providerId: identity.providerId,
            })
        )
      );

      yield* managedDns
        .remove(
          customDomainIdentityDnsOwner(
            input.customDomain.id,
            identity.providerId
          )
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new CustomDomainError({
                cause,
                customDomainId: input.customDomain.id,
                message: "Failed to remove identity DNS during claim.",
                operation: "claim",
                providerId: identity.providerId,
              })
          )
        );

      yield* input.db
        .delete(emailDomainProviderIdentity)
        .where(eq(emailDomainProviderIdentity.id, identity.id))
        .pipe(
          Effect.mapError(
            (cause) =>
              new CustomDomainError({
                cause,
                customDomainId: input.customDomain.id,
                message: "Failed to delete identity row during claim.",
                operation: "claim",
                providerId: identity.providerId,
              })
          )
        );
    }
  });

/**
 * Unlink a Project from a Custom Domain. When no other Projects remain, tear
 * down provider identities, managed DNS, DNS rows, and the domain row.
 */
export const deleteCustomDomain = (input: DeleteCustomDomainInput) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const managedDns = yield* EmailManagedDns;
    const credentialsVault = yield* ProviderCredentialsVault;
    const providers = yield* EmailProviderRegistry;

    const link = yield* db.query.organizationDomain
      .findFirst({
        where: {
          customDomainId: input.customDomainId,
          organizationId: input.organizationId,
        },
        with: {
          customDomain: {
            with: {
              organizations: true,
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
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to load Custom Domain for delete.",
              operation: "delete",
              organizationId: input.organizationId,
            })
        )
      );

    if (!link?.customDomain) {
      return yield* new CustomDomainError({
        customDomainId: input.customDomainId,
        message: "Domain is not linked to this Project.",
        operation: "persist",
        organizationId: input.organizationId,
      });
    }

    const domain = link.customDomain;

    yield* db
      .delete(organizationDomain)
      .where(
        and(
          eq(organizationDomain.organizationId, input.organizationId),
          eq(organizationDomain.customDomainId, input.customDomainId)
        )
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to unlink Custom Domain from Project.",
              operation: "delete",
              organizationId: input.organizationId,
            })
        )
      );

    const remainingRefs = domain.organizations.filter(
      (organization) => organization.organizationId !== input.organizationId
    ).length;

    if (remainingRefs > 0) {
      return { deleted: false as const };
    }

    for (const identity of domain.providerIdentities) {
      if (!identity.provider) {
        continue;
      }

      const factory = yield* providers
        .get(
          makeProviderTypeId(
            identity.provider.vendorId,
            identity.provider.productId
          )
        )
        .pipe(
          Effect.mapError(
            (cause) =>
              new CustomDomainError({
                cause,
                customDomainId: domain.id,
                message: "Email provider type is not registered.",
                operation: "provider",
                providerId: identity.providerId,
              })
          )
        );

      const credentials = yield* credentialsVault
        .open(identity.provider.credentials)
        .pipe(
          Effect.mapError(
            (cause) =>
              new CustomDomainError({
                cause,
                customDomainId: domain.id,
                message: "Failed to open provider credentials.",
                operation: "provider",
                providerId: identity.providerId,
              })
          )
        );

      const adapter = yield* factory
        .create({
          credentials,
          providerId: identity.provider.id,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new CustomDomainError({
                cause,
                customDomainId: domain.id,
                message: "Failed to create email provider adapter.",
                operation: "provider",
                providerId: identity.providerId,
              })
          )
        );

      yield* adapter.deleteIdentity({ fqdn: domain.fqdn }).pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: domain.id,
              message: "Failed to delete provider identity.",
              operation: "delete",
              providerId: identity.providerId,
            })
        )
      );

      yield* managedDns
        .remove(customDomainIdentityDnsOwner(domain.id, identity.providerId))
        .pipe(
          Effect.mapError(
            (cause) =>
              new CustomDomainError({
                cause,
                customDomainId: domain.id,
                message: "Failed to remove identity DNS.",
                operation: "delete",
                providerId: identity.providerId,
              })
          )
        );

      yield* db
        .delete(emailDomainProviderIdentity)
        .where(eq(emailDomainProviderIdentity.id, identity.id))
        .pipe(
          Effect.mapError(
            (cause) =>
              new CustomDomainError({
                cause,
                customDomainId: domain.id,
                message: "Failed to delete identity row.",
                operation: "delete",
                providerId: identity.providerId,
              })
          )
        );
    }

    yield* managedDns.remove(customDomainRootDnsOwner(domain.id)).pipe(
      Effect.mapError(
        (cause) =>
          new CustomDomainError({
            cause,
            customDomainId: domain.id,
            message: "Failed to remove root DNS.",
            operation: "delete",
          })
      )
    );

    yield* db
      .delete(emailDnsRecord)
      .where(eq(emailDnsRecord.customDomainId, domain.id))
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: domain.id,
              message: "Failed to delete DNS rows.",
              operation: "delete",
            })
        )
      );

    yield* db
      .delete(customDomain)
      .where(eq(customDomain.id, domain.id))
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: domain.id,
              message: "Failed to delete Custom Domain row.",
              operation: "delete",
            })
        )
      );

    return { deleted: true as const };
  });
