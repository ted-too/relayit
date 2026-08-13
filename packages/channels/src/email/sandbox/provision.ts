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
import { Data, Effect } from "effect";
import { makeProviderTypeId } from "../../provider-type";
import type { DomainKeyMaterial } from "../dkim";
import { EmailManagedDns } from "../managed-dns";
import { EmailProviderRegistry } from "../provider-registry";
import {
  emailVerifyProviderIdentityJob,
  emailVerifySandboxDomainJob,
} from "../verification/jobs";
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
    | "create"
    | "encrypt_key"
    | "load_key"
    | "persist"
    | "provider"
    | "register_identity"
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
