import { Jobs } from "@repo/jobs";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { type Database, DB } from "@repo/persistence/db/effect";
import {
  customDomain,
  emailDomainRegistration,
  removedDomainIdentity,
  type SandboxDomain,
  sandboxDomain,
} from "@repo/persistence/db/schema";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import { EmailBackend } from "../backend";
import { IDENTITY_CALL_TIMEOUT, lockDomainIdentity } from "../custom-domain/lifecycle";
import type { DomainKeyMaterial } from "../dkim";
import { EmailManagedDns } from "../managed-dns";
import { emailVerifySandboxDomainJob } from "../verification/jobs";
import { sweepIfSandboxAllocatable } from "./allocate";
import { isAtOrUnderRoot, lockSandboxRoots } from "./reserved";
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

/** A Project holds the root, or a name under it, as a custom Domain: no Sandbox Domain there. */
export class SandboxDomainRootHeld extends Data.TaggedError("SandboxDomainRootHeld")<{
  readonly customDomainId: string;
  readonly fqdn: string;
  readonly message: string;
  readonly rootDomain: string;
}> {}

/**
 * How long publishing one set of records on Cloudflare may take, under `lockDomainIdentity`,
 * before it is given up. One set is a few records, each a request or three.
 */
const MANAGED_DNS_TIMEOUT = "30 seconds";

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
 * Publishes the root's DKIM and DMARC records on our zone, registers the root with SES in
 * the default region (MAIL FROM DNS on our zone too) and records where. Each step is safe to
 * repeat, so the next start finishes a registration that failed.
 */
const registerSandboxIdentity = (input: {
  readonly db: Database;
  readonly sandboxDomain: SandboxDomain;
}) =>
  Effect.gen(function* () {
    const backend = yield* EmailBackend;
    const managedDns = yield* EmailManagedDns;
    const region = backend.defaultRegion;
    const sandboxDomainId = input.sandboxDomain.id;
    const keyMaterial = yield* loadSandboxKeyMaterial(input.sandboxDomain);
    // The name the identity lock and a removed Domain's record know it by: a custom
    // Domain's FQDN is kept in lower case.
    const fqdn = input.sandboxDomain.rootDomain.toLowerCase();

    yield* input.db
      .transaction((tx) =>
        Effect.gen(function* () {
          // SES names an identity by its FQDN alone, so this takes the lock a custom Domain's
          // registration and the job deleting a removed Domain's identity take for the name.
          yield* lockDomainIdentity(tx, fqdn);
          // Another worker starting at the same moment registered it while this one waited.
          const [registered] = yield* tx
            .select({ id: emailDomainRegistration.id })
            .from(emailDomainRegistration)
            .where(eq(emailDomainRegistration.sandboxDomainId, sandboxDomainId))
            .limit(1);
          if (registered) {
            return;
          }

          yield* managedDns
            .reconcile({
              cloudflareZoneId: input.sandboxDomain.cloudflareZoneId,
              owner: sandboxRootDnsOwner(sandboxDomainId),
              records: buildSandboxRootDnsRecords({
                dkimPublicKey: keyMaterial.dkimPublicKey,
                dkimSelector: keyMaterial.dkimSelector,
                fqdn: input.sandboxDomain.rootDomain,
              }),
              sandboxDomainId,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new SandboxDomainError({
                    cause,
                    message: "Failed to materialize sandbox root DNS.",
                    operation: "create",
                    sandboxDomainId,
                  }),
              ),
              // As for the SES call below: a Cloudflare request that never answers would
              // hold the worker's start, this connection and the name's identity lock.
              // Each step is safe to repeat, so the next start publishes what this one
              // did not.
              Effect.timeoutOrElse({
                duration: MANAGED_DNS_TIMEOUT,
                orElse: () =>
                  Effect.fail(
                    new SandboxDomainError({
                      message:
                        "Cloudflare did not answer in time while publishing the sandbox domain's root DNS.",
                      operation: "create",
                      sandboxDomainId,
                    }),
                  ),
              }),
            );

          // The root was a Project's Domain before, removed, and SES may still hold that
          // Domain's identity. Its delete job leaves a Sandbox Domain's name alone, so it
          // goes here, as a custom Domain's registration deletes one. Only an identity
          // recorded this way is Relayit's to replace: any other is refused below.
          const left = yield* tx
            .select({
              dkimSelector: removedDomainIdentity.dkimSelector,
              id: removedDomainIdentity.id,
            })
            .from(removedDomainIdentity)
            .where(
              and(
                eq(removedDomainIdentity.fqdn, fqdn),
                or(isNull(removedDomainIdentity.region), eq(removedDomainIdentity.region, region)),
              ),
            );

          const identity = yield* Effect.forEach(
            left,
            ({ dkimSelector }) => backend.deleteIdentity({ dkimSelector, fqdn, region }),
            { discard: true },
          ).pipe(
            Effect.andThen(
              backend.createIdentity({
                dkimPrivateKey: keyMaterial.dkimPrivateKey,
                dkimSelector: keyMaterial.dkimSelector,
                fqdn: input.sandboxDomain.rootDomain,
                region,
              }),
            ),
            Effect.mapError((cause) => {
              switch (cause._tag) {
                // Nothing was changed in SES, and every start fails this way until someone
                // deletes the identity there or the root is changed.
                case "EmailBackendIdentityConflict":
                  return new SandboxDomainError({
                    cause,
                    message:
                      "The sandbox root already has an SES identity that Relayit did not create; it was left untouched.",
                    operation: "register_identity",
                    sandboxDomainId,
                  });
                default:
                  return new SandboxDomainError({
                    cause,
                    message: "Failed to register the sandbox domain with SES.",
                    operation: "register_identity",
                    sandboxDomainId,
                  });
              }
            }),
            // A call that never answers would hold the worker's start, this connection and
            // the name's identity lock. The next start finishes the registration.
            Effect.timeoutOrElse({
              duration: IDENTITY_CALL_TIMEOUT,
              orElse: () =>
                Effect.fail(
                  new SandboxDomainError({
                    message: "SES did not answer in time while registering the sandbox domain.",
                    operation: "register_identity",
                    sandboxDomainId,
                  }),
                ),
            }),
          );

          yield* managedDns
            .reconcile({
              cloudflareZoneId: input.sandboxDomain.cloudflareZoneId,
              owner: sandboxIdentityDnsOwner(sandboxDomainId),
              records: resolveSandboxMailFromRecords({
                records: identity.mailFrom.records,
              }),
              sandboxDomainId,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new SandboxDomainError({
                    cause,
                    message: "Failed to materialize sandbox MAIL FROM DNS.",
                    operation: "register_identity",
                    sandboxDomainId,
                  }),
              ),
              // The identity is in SES by now and nothing records it; the next start
              // creates it again, which SES answers as it did here, and publishes these.
              Effect.timeoutOrElse({
                duration: MANAGED_DNS_TIMEOUT,
                orElse: () =>
                  Effect.fail(
                    new SandboxDomainError({
                      message:
                        "Cloudflare did not answer in time while publishing the sandbox domain's MAIL FROM DNS.",
                      operation: "register_identity",
                      sandboxDomainId,
                    }),
                  ),
              }),
            );

          yield* tx.insert(emailDomainRegistration).values({
            region,
            sandboxDomainId,
            verificationStatus: "not_verified",
          });
          if (left.length > 0) {
            yield* tx.delete(removedDomainIdentity).where(
              inArray(
                removedDomainIdentity.id,
                left.map(({ id }) => id),
              ),
            );
          }
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          switch (error._tag) {
            case "SandboxDomainError":
              return error;
            default:
              return new SandboxDomainError({
                cause: error,
                message: "Failed to record the sandbox domain registration.",
                operation: "persist",
                sandboxDomainId,
              });
          }
        }),
      );
  });

/**
 * Idempotent, run as the worker starts when Cloudflare is configured: the Cloudflare root
 * is the singleton Sandbox Domain. Creates and registers it the first time, registers it
 * if it has no registration, and assigns unassigned Projects once it can send.
 */
export const ensureSandboxDomain = (input: EnsureSandboxDomainInput) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const jobs = yield* Jobs;
    const crypto = yield* SymmetricCrypto;
    // A name is the same name in any case: `CF_ROOT_DOMAIN` typed in another case is the
    // Sandbox Domain already there, not a second one on the same SES identity.
    const rootDomain = input.rootDomain.toLowerCase();

    const existing = yield* db.query.sandboxDomain
      .findFirst({
        where: { RAW: (table) => sql`lower(${table.rootDomain}) = ${rootDomain}` },
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
    if (existing?.registration) {
      sandboxDomainId = existing.id;
    } else {
      // SES names an identity by its FQDN alone, so a Sandbox Domain on a root a Project holds
      // as a custom Domain would be registered as that Domain's identity, and a custom Domain
      // under the root has its DNS in the zone the sandbox publishes to. `createCustomDomain`
      // refuses the reverse, on the Sandbox Domain's row, so the check and the row are one
      // step under the lock that orders the two. Checked before anything is made, and only
      // until the Sandbox Domain is registered: one already sending is not stopped by a
      // Domain found later.
      const unregistered = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            yield* lockSandboxRoots(tx, "exclusive");
            const [held] = yield* tx
              .select({ fqdn: customDomain.fqdn, id: customDomain.id })
              .from(customDomain)
              .where(isAtOrUnderRoot(customDomain.fqdn, rootDomain))
              .limit(1);
            if (held) {
              return yield* new SandboxDomainRootHeld({
                customDomainId: held.id,
                fqdn: held.fqdn,
                message:
                  "The Sandbox Domain's root, or a name under it, is a Project's custom Domain. Remove that Domain or configure another root; nothing was created.",
                rootDomain: input.rootDomain,
              });
            }
            // Read again: another worker starting at the same moment wrote it while this
            // one waited for the lock.
            const [written] = yield* tx
              .select()
              .from(sandboxDomain)
              .where(sql`lower(${sandboxDomain.rootDomain}) = ${rootDomain}`)
              .limit(1);
            if (written) {
              return written;
            }
            const keyMaterial = createDomainKeyMaterial();
            const dkimPrivateKey = yield* crypto.encrypt(keyMaterial.dkimPrivateKey).pipe(
              Effect.mapError(
                (cause) =>
                  new SandboxDomainError({
                    cause,
                    message: "Failed to encrypt sandbox DKIM private key.",
                    operation: "encrypt_key",
                  }),
              ),
            );
            const [inserted] = yield* tx
              .insert(sandboxDomain)
              .values({
                cloudflareZoneId: input.cloudflareZoneId,
                dkimPrivateKey,
                dkimPublicKey: keyMaterial.dkimPublicKey,
                dkimSelector: keyMaterial.dkimSelector,
                isActive: false,
                rootDomain,
                verificationStatus: "not_verified",
                verifyBackoffLevel: 0,
              })
              .returning();
            return (
              inserted ??
              (yield* new SandboxDomainError({
                message: "Failed to insert sandbox domain.",
                operation: "persist",
              }))
            );
          }),
        )
        .pipe(
          Effect.mapError((error) => {
            switch (error._tag) {
              case "SandboxDomainError":
              case "SandboxDomainRootHeld":
                return error;
              default:
                return new SandboxDomainError({
                  cause: error,
                  message: "Failed to write the sandbox domain.",
                  operation: "persist",
                });
            }
          }),
        );
      sandboxDomainId = unregistered.id;

      yield* registerSandboxIdentity({ db, sandboxDomain: unregistered });

      // In Redis, after the registration commits, so it can fail or be lost: the worker's
      // startup reconcile schedules a registered Sandbox Domain no check has run for.
      yield* jobs.schedule(emailVerifySandboxDomainJob, { sandboxDomainId }, Date.now()).pipe(
        Effect.mapError(
          (cause) =>
            new SandboxDomainError({
              cause,
              message: "Failed to schedule sandbox verification job.",
              operation: "schedule",
              sandboxDomainId,
            }),
        ),
      );
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
