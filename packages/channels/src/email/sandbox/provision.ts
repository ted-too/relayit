import { Jobs } from "@repo/jobs";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { type DatabaseExecutor, DB } from "@repo/persistence/db/effect";
import {
  emailDomainRegistration,
  type SandboxDomain,
  sandboxDomain,
} from "@repo/persistence/db/schema";
import { Data, Effect } from "effect";
import { EmailBackend } from "../backend";
import type { DomainKeyMaterial } from "../dkim";
import { EmailManagedDns } from "../managed-dns";
import { emailVerifySandboxDomainJob } from "../verification/jobs";
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
    | "allocate"
    | "create"
    | "encrypt_key"
    | "load_key"
    | "persist"
    | "register_identity"
    | "schedule";
  readonly sandboxDomainId?: string;
}> {}

export interface EnsureSandboxDomainInput {
  readonly cloudflareZoneId: string;
  readonly rootDomain: string;
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
          }),
      ),
    );

    return {
      dkimPrivateKey,
      dkimPublicKey: sandbox.dkimPublicKey,
      dkimSelector: sandbox.dkimSelector,
    } satisfies DomainKeyMaterial;
  });

/**
 * Registers the sandbox root with SES in the default region (MAIL FROM DNS on our zone),
 * records where, and schedules its first verification.
 */
const registerSandboxIdentity = (input: {
  readonly db: DatabaseExecutor;
  readonly keyMaterial: DomainKeyMaterial;
  readonly sandboxDomain: Pick<SandboxDomain, "cloudflareZoneId" | "id" | "rootDomain">;
}) =>
  Effect.gen(function* () {
    const backend = yield* EmailBackend;
    const managedDns = yield* EmailManagedDns;
    const jobs = yield* Jobs;
    const region = backend.defaultRegion;

    const identity = yield* backend
      .createIdentity({
        dkimPrivateKey: input.keyMaterial.dkimPrivateKey,
        dkimSelector: input.keyMaterial.dkimSelector,
        fqdn: input.sandboxDomain.rootDomain,
        region,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to register the sandbox domain with SES.",
              operation: "register_identity",
              sandboxDomainId: input.sandboxDomain.id,
            }),
        ),
      );

    yield* managedDns
      .reconcile({
        cloudflareZoneId: input.sandboxDomain.cloudflareZoneId,
        owner: sandboxIdentityDnsOwner(input.sandboxDomain.id),
        records: resolveSandboxMailFromRecords({
          records: identity.mailFrom.records,
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
              sandboxDomainId: input.sandboxDomain.id,
            }),
        ),
      );

    yield* input.db
      .insert(emailDomainRegistration)
      .values({
        region,
        sandboxDomainId: input.sandboxDomain.id,
        verificationStatus: "not_verified",
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to record the sandbox domain registration.",
              operation: "persist",
              sandboxDomainId: input.sandboxDomain.id,
            }),
        ),
      );

    yield* jobs
      .schedule(
        emailVerifySandboxDomainJob,
        { sandboxDomainId: input.sandboxDomain.id },
        Date.now(),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to schedule sandbox verification job.",
              operation: "schedule",
              sandboxDomainId: input.sandboxDomain.id,
            }),
        ),
      );
  });

/** A new sandbox root: BYODKIM key material and its DKIM and DMARC records on our zone. */
const createSandboxDomain = (input: EnsureSandboxDomainInput) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const managedDns = yield* EmailManagedDns;
    const crypto = yield* SymmetricCrypto;
    const keyMaterial = createDomainKeyMaterial();

    const encryptedPrivateKey = yield* crypto.encrypt(keyMaterial.dkimPrivateKey).pipe(
      Effect.mapError(
        (cause) =>
          new SandboxDomainError({
            cause,
            message: "Failed to encrypt sandbox DKIM private key.",
            operation: "encrypt_key",
          }),
      ),
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
            }),
        ),
      );

    if (!row) {
      return yield* new SandboxDomainError({
        message: "Failed to insert sandbox domain.",
        operation: "persist",
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
              sandboxDomainId: row.id,
            }),
        ),
      );

    yield* registerSandboxIdentity({ db, keyMaterial, sandboxDomain: row });
    return row.id;
  });

/**
 * Idempotent, run as the worker starts when Cloudflare is configured: the Cloudflare root
 * is the singleton Sandbox Domain. Creates and registers it the first time, registers it
 * if it has no registration, and assigns unassigned Projects once it can send.
 */
export const ensureSandboxDomain = (input: EnsureSandboxDomainInput) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const existing = yield* db.query.sandboxDomain
      .findFirst({
        where: { rootDomain: input.rootDomain },
        with: { registration: true },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to load sandbox domain.",
              operation: "persist",
            }),
        ),
      );

    let sandboxDomainId: string;
    if (existing) {
      sandboxDomainId = existing.id;
      if (!existing.registration) {
        yield* registerSandboxIdentity({
          db,
          keyMaterial: yield* loadSandboxKeyMaterial(existing),
          sandboxDomain: existing,
        });
      }
    } else {
      sandboxDomainId = yield* createSandboxDomain(input);
    }

    return yield* sweepIfSandboxAllocatable(sandboxDomainId).pipe(
      Effect.mapError(
        (cause) =>
          new SandboxDomainError({
            cause,
            message: "Failed to allocate Projects to the sandbox domain.",
            operation: "allocate",
            sandboxDomainId,
          }),
      ),
    );
  });
