import { Jobs } from "@repo/jobs";
import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { type DatabaseExecutor, DB } from "@repo/persistence/db/effect";
import {
  emailDomainProviderIdentity,
  type Provider,
  type SandboxDomain,
  sandboxDomain,
} from "@repo/persistence/db/schema";
import { eq } from "drizzle-orm";
import { Data, Effect } from "effect";
import { makeProviderTypeId } from "../../provider-type";
import type { DomainKeyMaterial } from "../dkim";
import { EmailManagedDns } from "../managed-dns";
import { EmailProviderRegistry } from "../provider-registry";
import {
  emailVerifyProviderIdentityJob,
  emailVerifySandboxDomainJob,
} from "../verification/jobs";
import { sweepIfSandboxAllocatable } from "./allocate";
import {
  buildSandboxRootDnsRecords,
  createDomainKeyMaterial,
  resolveSandboxMailFromRecords,
  sandboxIdentityDnsOwner,
  sandboxRootDnsOwner,
} from "./dns";

export class SandboxDomainError extends Data.TaggedError("SandboxDomainError")<{
  readonly cause?: unknown;
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
  readonly operation:
    | "add_identity"
    | "allocate"
    | "create"
    | "encrypt_key"
    | "load_key"
    | "persist"
    | "provider"
    | "register_identity"
    | "remove"
    | "schedule"
    | "unavailable";
  readonly providerId?: string;
  readonly sandboxDomainId?: string;
}> {}

export interface CreateSandboxDomainInput {
  readonly cloudflareZoneId: string;
  readonly provider: Provider;
  readonly rootDomain: string;
}

export interface AddSandboxProviderIdentityInput {
  readonly provider: Provider;
  readonly sandboxDomain: SandboxDomain;
}

const loadSandboxKeyMaterial = (sandbox: SandboxDomain) =>
  Effect.gen(function* () {
    const crypto = yield* SymmetricCrypto;
    const dkimPrivateKey = yield* crypto.decrypt(sandbox.dkimPrivateKey).pipe(
      Effect.mapError(
        (cause) =>
          new SandboxDomainError({
            cause,
            message: "Failed to decrypt sandbox DKIM private key.",
            operation: "load_key",
            sandboxDomainId: sandbox.id,
          })
      )
    );

    return {
      dkimPrivateKey,
      dkimPublicKey: sandbox.dkimPublicKey,
      dkimSelector: sandbox.dkimSelector,
    } satisfies DomainKeyMaterial;
  });

const registerSandboxProviderIdentity = (input: {
  readonly db: DatabaseExecutor;
  readonly keyMaterial: DomainKeyMaterial;
  readonly provider: Provider;
  readonly sandboxDomain: Pick<
    SandboxDomain,
    "cloudflareZoneId" | "id" | "rootDomain"
  >;
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
            new SandboxDomainError({
              cause,
              message: "Email provider type is not registered.",
              operation: "provider",
              providerId: input.provider.id,
              sandboxDomainId: input.sandboxDomain.id,
            })
        )
      );

    const credentials = yield* credentialsVault
      .open(input.provider.credentials)
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to open provider credentials.",
              operation: "provider",
              providerId: input.provider.id,
              sandboxDomainId: input.sandboxDomain.id,
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
            new SandboxDomainError({
              cause,
              message: "Failed to create email provider adapter.",
              operation: "provider",
              providerId: input.provider.id,
              sandboxDomainId: input.sandboxDomain.id,
            })
        )
      );

    const identityResult = yield* adapter
      .createIdentity({
        dkimPrivateKey: input.keyMaterial.dkimPrivateKey,
        dkimSelector: input.keyMaterial.dkimSelector,
        fqdn: input.sandboxDomain.rootDomain,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to create provider sending identity.",
              operation: "register_identity",
              providerId: input.provider.id,
              sandboxDomainId: input.sandboxDomain.id,
            })
        )
      );

    yield* managedDns
      .reconcile({
        cloudflareZoneId: input.sandboxDomain.cloudflareZoneId,
        owner: sandboxIdentityDnsOwner(
          input.sandboxDomain.id,
          input.provider.id
        ),
        records: resolveSandboxMailFromRecords({
          records: identityResult.mailFrom.records,
        }),
        sandboxDomainId: input.sandboxDomain.id,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to materialize sandbox MAIL FROM DNS.",
              operation: "register_identity",
              providerId: input.provider.id,
              sandboxDomainId: input.sandboxDomain.id,
            })
        )
      );

    const existing = yield* input.db.query.emailDomainProviderIdentity
      .findMany({
        columns: {
          failoverPriority: true,
          isActive: true,
        },
        where: { sandboxDomainId: input.sandboxDomain.id },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to list sandbox provider identities.",
              operation: "persist",
              providerId: input.provider.id,
              sandboxDomainId: input.sandboxDomain.id,
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
        customDomainId: null,
        failoverEligible: true,
        failoverPriority: hasActive ? maxPriority + 1 : 0,
        isActive: !hasActive,
        providerData: identityResult.providerData,
        providerId: input.provider.id,
        sandboxDomainId: input.sandboxDomain.id,
        verificationStatus: "not_verified",
        verifyBackoffLevel: 0,
      })
      .returning()
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to insert sandbox provider identity.",
              operation: "persist",
              providerId: input.provider.id,
              sandboxDomainId: input.sandboxDomain.id,
            })
        )
      );

    if (!identity) {
      return yield* new SandboxDomainError({
        message: "Failed to insert sandbox provider identity.",
        operation: "persist",
        providerId: input.provider.id,
        sandboxDomainId: input.sandboxDomain.id,
      });
    }

    return identity;
  });

const scheduleInitialVerification = (input: {
  readonly identityId: string;
  readonly providerId: string;
  readonly sandboxDomainId: string;
}) =>
  Effect.gen(function* () {
    const jobs = yield* Jobs;
    const runAt = Date.now();

    yield* jobs
      .schedule(
        emailVerifySandboxDomainJob,
        { sandboxDomainId: input.sandboxDomainId },
        runAt
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to schedule sandbox verification job.",
              operation: "schedule",
              providerId: input.providerId,
              sandboxDomainId: input.sandboxDomainId,
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
            new SandboxDomainError({
              cause,
              message: "Failed to schedule identity verification job.",
              operation: "schedule",
              providerId: input.providerId,
              sandboxDomainId: input.sandboxDomainId,
            })
        )
      );
  });

/**
 * Create a platform sandbox root: BYODKIM key material, Cloudflare DNS for
 * DKIM/DMARC, and the first provider identity (SES + MAIL FROM DNS).
 * Requires Cloudflare (sandbox capability).
 */
export const createSandboxDomain = (input: CreateSandboxDomainInput) =>
  Effect.gen(function* () {
    const managedDns = yield* EmailManagedDns;
    if (!managedDns.cloudflareEnabled) {
      return yield* new SandboxDomainError({
        message: "Sandbox Domains require Cloudflare to be configured.",
        operation: "unavailable",
        providerId: input.provider.id,
      });
    }

    const db = yield* DB;
    const crypto = yield* SymmetricCrypto;
    const keyMaterial = createDomainKeyMaterial();

    const encryptedPrivateKey = yield* crypto
      .encrypt(keyMaterial.dkimPrivateKey)
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to encrypt sandbox DKIM private key.",
              operation: "encrypt_key",
              providerId: input.provider.id,
            })
        )
      );

    const [row] = yield* db
      .insert(sandboxDomain)
      .values({
        cloudflareZoneId: input.cloudflareZoneId,
        dkimPrivateKey: encryptedPrivateKey,
        dkimPublicKey: keyMaterial.dkimPublicKey,
        dkimSelector: keyMaterial.dkimSelector,
        isActive: false,
        rootDomain: input.rootDomain,
        verificationStatus: "not_verified",
        verifyBackoffLevel: 0,
      })
      .returning()
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to insert sandbox domain.",
              operation: "persist",
              providerId: input.provider.id,
            })
        )
      );

    if (!row) {
      return yield* new SandboxDomainError({
        message: "Failed to insert sandbox domain.",
        operation: "persist",
        providerId: input.provider.id,
      });
    }

    yield* managedDns
      .reconcile({
        cloudflareZoneId: input.cloudflareZoneId,
        owner: sandboxRootDnsOwner(row.id),
        records: buildSandboxRootDnsRecords({
          dkimPublicKey: keyMaterial.dkimPublicKey,
          dkimSelector: keyMaterial.dkimSelector,
          fqdn: input.rootDomain,
        }),
        sandboxDomainId: row.id,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to materialize sandbox root DNS.",
              operation: "create",
              providerId: input.provider.id,
              sandboxDomainId: row.id,
            })
        )
      );

    const identity = yield* registerSandboxProviderIdentity({
      db,
      keyMaterial,
      provider: input.provider,
      sandboxDomain: row,
    });

    yield* scheduleInitialVerification({
      identityId: identity.id,
      providerId: input.provider.id,
      sandboxDomainId: row.id,
    });

    return {
      identityId: identity.id,
      sandboxDomainId: row.id,
    };
  });

/**
 * Attach an additional platform provider to an existing sandbox root, reusing
 * the shared BYODKIM key material. Requires Cloudflare (sandbox capability).
 */
export const addSandboxProviderIdentity = (
  input: AddSandboxProviderIdentityInput
) =>
  Effect.gen(function* () {
    const managedDns = yield* EmailManagedDns;
    if (!managedDns.cloudflareEnabled) {
      return yield* new SandboxDomainError({
        message: "Sandbox Domains require Cloudflare to be configured.",
        operation: "unavailable",
        providerId: input.provider.id,
        sandboxDomainId: input.sandboxDomain.id,
      });
    }

    const db = yield* DB;
    const keyMaterial = yield* loadSandboxKeyMaterial(input.sandboxDomain);
    const identity = yield* registerSandboxProviderIdentity({
      db,
      keyMaterial,
      provider: input.provider,
      sandboxDomain: input.sandboxDomain,
    });

    yield* scheduleInitialVerification({
      identityId: identity.id,
      providerId: input.provider.id,
      sandboxDomainId: input.sandboxDomain.id,
    });

    return { identityId: identity.id };
  });

export interface EnsureSandboxForProviderInput {
  readonly cloudflareZoneId: string | null;
  readonly provider: Provider;
  readonly rootDomain: string | null;
}

export interface EnsureSandboxForProviderResult {
  readonly allocated: number;
  readonly identityId: string | null;
  readonly sandboxDomainId: string | null;
}

const sweepAllocated = (sandboxDomainId: string) =>
  sweepIfSandboxAllocatable(sandboxDomainId).pipe(
    Effect.mapError(
      (cause) =>
        new SandboxDomainError({
          cause,
          message: "Failed to allocate Projects to the sandbox domain.",
          operation: "allocate",
          sandboxDomainId,
        })
    )
  );

/**
 * Idempotent: the Cloudflare root is the singleton sandbox. First managed
 * Provider creates it; later Providers attach an identity and reuse BYODKIM.
 * Sweeps unassigned Projects when the root is already allocatable.
 */
export const ensureSandboxForProvider = (
  input: EnsureSandboxForProviderInput
) =>
  Effect.gen(function* () {
    if (!(input.cloudflareZoneId && input.rootDomain)) {
      return {
        allocated: 0,
        identityId: null,
        sandboxDomainId: null,
      } satisfies EnsureSandboxForProviderResult;
    }

    const db = yield* DB;
    const existing = yield* db.query.sandboxDomain
      .findFirst({
        where: { rootDomain: input.rootDomain },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to load sandbox domain.",
              operation: "persist",
              providerId: input.provider.id,
            })
        )
      );

    if (!existing) {
      const created = yield* createSandboxDomain({
        cloudflareZoneId: input.cloudflareZoneId,
        provider: input.provider,
        rootDomain: input.rootDomain,
      });
      const allocated = yield* sweepAllocated(created.sandboxDomainId);
      return {
        allocated,
        identityId: created.identityId,
        sandboxDomainId: created.sandboxDomainId,
      };
    }

    const identity = yield* db.query.emailDomainProviderIdentity
      .findFirst({
        where: {
          providerId: input.provider.id,
          sandboxDomainId: existing.id,
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to load sandbox provider identity.",
              operation: "persist",
              providerId: input.provider.id,
              sandboxDomainId: existing.id,
            })
        )
      );

    if (!identity) {
      const added = yield* addSandboxProviderIdentity({
        provider: input.provider,
        sandboxDomain: existing,
      });
      const allocated = yield* sweepAllocated(existing.id);
      return {
        allocated,
        identityId: added.identityId,
        sandboxDomainId: existing.id,
      };
    }

    const allocated = yield* sweepAllocated(existing.id);
    return {
      allocated,
      identityId: identity.id,
      sandboxDomainId: existing.id,
    };
  });

const openProviderAdapter = (provider: Provider) =>
  Effect.gen(function* () {
    const credentialsVault = yield* ProviderCredentialsVault;
    const providers = yield* EmailProviderRegistry;
    const factory = yield* providers
      .get(makeProviderTypeId(provider.vendorId, provider.productId))
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Email provider type is not registered.",
              operation: "provider",
              providerId: provider.id,
            })
        )
      );

    const credentials = yield* credentialsVault.open(provider.credentials).pipe(
      Effect.mapError(
        (cause) =>
          new SandboxDomainError({
            cause,
            message: "Failed to open provider credentials.",
            operation: "provider",
            providerId: provider.id,
          })
      )
    );

    return yield* factory
      .create({
        credentials,
        providerId: provider.id,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to create email provider adapter.",
              operation: "provider",
              providerId: provider.id,
            })
        )
      );
  });

/**
 * Tear down this Provider's sandbox identity (SES + MAIL FROM DNS). The
 * singleton sandbox root (BYODKIM + DKIM/DMARC) stays.
 */
export const removeSandboxProviderIdentity = (provider: Provider) =>
  Effect.gen(function* () {
    const db = yield* DB;

    const identity = yield* db.query.emailDomainProviderIdentity
      .findFirst({
        where: {
          providerId: provider.id,
          sandboxDomainId: { isNotNull: true },
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to load sandbox provider identity.",
              operation: "persist",
              providerId: provider.id,
            })
        )
      );

    if (!identity?.sandboxDomainId) {
      return;
    }

    const sandboxDomainId = identity.sandboxDomainId;
    const sandbox = yield* db.query.sandboxDomain
      .findFirst({
        columns: { rootDomain: true },
        where: { id: sandboxDomainId },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to load sandbox domain.",
              operation: "persist",
              providerId: provider.id,
              sandboxDomainId,
            })
        )
      );

    if (sandbox) {
      const adapter = yield* openProviderAdapter(provider);
      yield* adapter.deleteIdentity({ fqdn: sandbox.rootDomain }).pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to delete provider sending identity.",
              operation: "remove",
              providerId: provider.id,
              sandboxDomainId,
            })
        )
      );
    }

    const managedDns = yield* EmailManagedDns;
    const jobs = yield* Jobs;

    yield* managedDns
      .remove(sandboxIdentityDnsOwner(sandboxDomainId, provider.id))
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to remove sandbox MAIL FROM DNS.",
              operation: "remove",
              providerId: provider.id,
              sandboxDomainId,
            })
        )
      );

    yield* db
      .delete(emailDomainProviderIdentity)
      .where(eq(emailDomainProviderIdentity.id, identity.id))
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to delete sandbox provider identity.",
              operation: "persist",
              providerId: provider.id,
              sandboxDomainId,
            })
        )
      );

    yield* jobs
      .cancel(emailVerifyProviderIdentityJob, { identityId: identity.id })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to cancel identity verification job.",
              operation: "schedule",
              providerId: provider.id,
              sandboxDomainId,
            })
        )
      );

    const remaining = yield* db.query.emailDomainProviderIdentity
      .findMany({
        where: { sandboxDomainId },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to list remaining sandbox identities.",
              operation: "persist",
              providerId: provider.id,
              sandboxDomainId,
            })
        )
      );

    if (remaining.length === 0) {
      yield* db
        .update(sandboxDomain)
        .set({ isActive: false })
        .where(eq(sandboxDomain.id, sandboxDomainId))
        .pipe(
          Effect.mapError(
            (cause) =>
              new SandboxDomainError({
                cause,
                message: "Failed to deactivate sandbox domain.",
                operation: "persist",
                providerId: provider.id,
                sandboxDomainId,
              })
          )
        );
      return;
    }

    if (identity.isActive && !remaining.some((row) => row.isActive)) {
      const next = remaining
        .filter((row) => row.failoverEligible)
        .toSorted((a, b) => a.failoverPriority - b.failoverPriority)[0];
      if (next) {
        yield* db
          .update(emailDomainProviderIdentity)
          .set({ isActive: true })
          .where(eq(emailDomainProviderIdentity.id, next.id))
          .pipe(
            Effect.mapError(
              (cause) =>
                new SandboxDomainError({
                  cause,
                  message: "Failed to promote sandbox failover identity.",
                  operation: "persist",
                  providerId: provider.id,
                  sandboxDomainId,
                })
            )
          );
      }
    }
  });
