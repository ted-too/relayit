import { Jobs } from "@repo/jobs";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import {
  type Database,
  type DatabaseExecutor,
  type DatabaseTransaction,
  DB,
} from "@repo/persistence/db/effect";
import {
  type CustomDomain,
  customDomain,
  type DomainPausedReason,
  emailDelivery,
  emailDeliveryEvent,
  emailDnsRecord,
  emailDomainRegistration,
  type OrganizationDomain,
  message,
  type OrganizationDomainInsert,
  organizationAppEnvironment,
  organizationDomain,
} from "@repo/persistence/db/schema";
import { and, eq, inArray, ne, notExists, type SQL, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import { EmailBackend } from "../backend";
import { emitDomainUpdated } from "../deliverability/project-sending-pause";
import type { DomainKeyMaterial } from "../dkim";
import { createDomainKeyMaterial } from "../dkim";
import { DnsLookups } from "../dns-lookups";
import { EmailManagedDns } from "../managed-dns";
import { emailVerifyCustomDomainJob, emailVerifyOwnershipJob } from "../verification/jobs";
import { emailDeleteDomainIdentityJob } from "./jobs";
import {
  buildCustomDomainRootDnsRecords,
  createOwnershipToken,
  customDomainIdentityDnsOwner,
  customDomainRootDnsOwner,
  resolveCustomDomainMailFromRecords,
} from "./dns";

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
    | "register_identity"
    | "schedule"
    | "unpause";
  readonly organizationId?: string;
}> {}

export interface CreateCustomDomainInput {
  readonly fqdn: string;
  readonly organizationId: string;
}

export class CustomDomainNotFound extends Data.TaggedError("CustomDomainNotFound")<{
  readonly customDomainId: string;
  readonly message: string;
}> {}

export interface PauseCustomDomainInput {
  readonly customDomainId: string;
  readonly reason: DomainPausedReason;
}

export interface UnpauseCustomDomainInput {
  readonly customDomainId: string;
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
          }),
      ),
    );

    return {
      dkimPrivateKey,
      dkimPublicKey: domain.dkimPublicKey,
      dkimSelector: domain.dkimSelector,
    } satisfies DomainKeyMaterial;
  });

/**
 * How long a claim has to prove ownership. One left unproven lapses and its next check
 * removes it, so abandoned claims don't pile up.
 */
export const CLAIM_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** How long an SES call made under `lockDomainIdentity` may take before it is given up. */
export const IDENTITY_CALL_TIMEOUT = "30 seconds";

/**
 * Held to the end of the transaction while a Domain's SES identity is created or deleted.
 * SES names an identity by its FQDN alone, so deleting a removed Domain's identity and
 * registering the same FQDN added again must not interleave.
 */
export const lockDomainIdentity = (tx: DatabaseTransaction, fqdn: string) =>
  tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`custom-domain-identity:${fqdn}`}, 0))`,
  );

/**
 * Records the Domain's root DNS records, registers it with SES in the default region and
 * records where. Each step is safe to repeat, so a retry finishes a registration that failed.
 */
const registerCustomDomainIdentity = (input: {
  readonly customDomainId: string;
  readonly db: Database;
  readonly fqdn: string;
  readonly keyMaterial: DomainKeyMaterial;
}) =>
  Effect.gen(function* () {
    const backend = yield* EmailBackend;
    const managedDns = yield* EmailManagedDns;
    const region = backend.defaultRegion;

    // The identity and its registration land as one step against the Domain's removal.
    // Holding the row keeps the Domain until the registration is recorded, so a removal
    // either came first, the row is gone and nothing is created, or comes after and
    // deletes the identity.
    yield* input.db
      .transaction((tx) =>
        Effect.gen(function* () {
          yield* lockDomainIdentity(tx, input.fqdn);
          const [held] = yield* tx
            .select({ id: customDomain.id })
            .from(customDomain)
            .where(eq(customDomain.id, input.customDomainId))
            .for("key share");
          if (!held) {
            return yield* new CustomDomainError({
              customDomainId: input.customDomainId,
              message: "Domain was removed before it was registered with SES.",
              operation: "register_identity",
            });
          }
          // Another add of the same unregistered Domain registered it while this one waited
          // for the lock.
          const [registered] = yield* tx
            .select({ id: emailDomainRegistration.id })
            .from(emailDomainRegistration)
            .where(eq(emailDomainRegistration.customDomainId, input.customDomainId))
            .limit(1);
          if (registered) {
            return;
          }

          yield* managedDns
            .reconcile({
              customDomainId: input.customDomainId,
              owner: customDomainRootDnsOwner(input.customDomainId),
              records: buildCustomDomainRootDnsRecords({
                dkimPublicKey: input.keyMaterial.dkimPublicKey,
                dkimSelector: input.keyMaterial.dkimSelector,
                fqdn: input.fqdn,
              }),
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new CustomDomainError({
                    cause,
                    customDomainId: input.customDomainId,
                    message: "Failed to materialize custom domain root DNS.",
                    operation: "create",
                  }),
              ),
            );

          const identity = yield* backend
            .createIdentity({
              dkimPrivateKey: input.keyMaterial.dkimPrivateKey,
              dkimSelector: input.keyMaterial.dkimSelector,
              fqdn: input.fqdn,
              region,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new CustomDomainError({
                    cause,
                    customDomainId: input.customDomainId,
                    message: "Failed to register the domain with SES.",
                    operation: "register_identity",
                  }),
              ),
              // A call that never answers would hold this connection, the Domain's row
              // and the FQDN's identity lock with it. Adding the Domain again finishes it,
              // for the Project that holds it and for one that claims it.
              Effect.timeoutOrElse({
                duration: IDENTITY_CALL_TIMEOUT,
                orElse: () =>
                  Effect.fail(
                    new CustomDomainError({
                      customDomainId: input.customDomainId,
                      message: "SES did not answer in time while registering the domain.",
                      operation: "register_identity",
                    }),
                  ),
              }),
            );

          yield* managedDns
            .reconcile({
              customDomainId: input.customDomainId,
              owner: customDomainIdentityDnsOwner(input.customDomainId),
              records: resolveCustomDomainMailFromRecords({
                records: identity.mailFrom.records,
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
                  }),
              ),
            );

          yield* tx.insert(emailDomainRegistration).values({
            customDomainId: input.customDomainId,
            region,
            verificationStatus: "not_verified",
          });
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          switch (error._tag) {
            case "CustomDomainError":
              return error;
            default:
              return new CustomDomainError({
                cause: error,
                customDomainId: input.customDomainId,
                message: "Failed to record the custom domain registration.",
                operation: "persist",
              });
          }
        }),
      );
  });

const scheduleCustomDomainVerification = (input: { readonly customDomainId: string }) =>
  Effect.gen(function* () {
    const jobs = yield* Jobs;

    yield* jobs
      .schedule(emailVerifyCustomDomainJob, { customDomainId: input.customDomainId }, Date.now())
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to schedule custom domain verification job.",
              operation: "schedule",
            }),
        ),
      );
  });

const scheduleOwnershipCheck = (claim: {
  readonly customDomainId: string;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const jobs = yield* Jobs;

    yield* jobs.schedule(emailVerifyOwnershipJob, claim, Date.now()).pipe(
      Effect.mapError(
        (cause) =>
          new CustomDomainError({
            cause,
            customDomainId: claim.customDomainId,
            message: "Failed to schedule ownership verification job.",
            operation: "schedule",
            organizationId: claim.organizationId,
          }),
      ),
    );
  });

const createOrgDomainLink = (input: {
  readonly customDomainId: string;
  readonly db: DatabaseExecutor;
  readonly organizationId: string;
  readonly ownershipVerified: boolean;
}) =>
  Effect.gen(function* () {
    const token = createOwnershipToken();

    yield* input.db
      .insert(organizationDomain)
      .values({
        customDomainId: input.customDomainId,
        organizationId: input.organizationId,
        ownershipToken: token,
        ownershipVerificationStatus: input.ownershipVerified ? "verified" : "not_verified",
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
            }),
        ),
      );

    return { token };
  });

/**
 * Add a Domain to a Project. A new FQDN is the Project's at once, and so is one that was
 * removed: its row went with its last link, so it is added with a new DKIM key and nothing
 * of what was sent from it before. One another Project is linked to becomes a claim the
 * Project proves with a TXT record before it may send from or change the Domain.
 */
export const createCustomDomain = (input: CreateCustomDomainInput) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const dnsLookups = yield* DnsLookups;

    const existing = yield* db.query.customDomain
      .findFirst({
        where: { fqdn: input.fqdn },
        with: {
          organizations: true,
          registration: true,
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
            }),
        ),
      );

    if (existing) {
      const ownLink = existing.organizations.find(
        (organization) => organization.organizationId === input.organizationId,
      );
      if (ownLink) {
        // A claim is checked from the moment it is made, and that check is what lapses it.
        // One whose check could not be scheduled gets it here.
        if (ownLink.ownershipVerificationStatus !== "verified") {
          yield* scheduleOwnershipCheck({
            customDomainId: existing.id,
            organizationId: input.organizationId,
          });
        }
        // An add that failed after writing the Domain or the claim left the Domain
        // unregistered, or registered and never checked because its verification was not
        // scheduled; adding it again finishes the job, for its holder and for a claimant.
        if (!existing.registration || existing.lastCheckedAt === null) {
          if (!existing.registration) {
            yield* registerCustomDomainIdentity({
              customDomainId: existing.id,
              db,
              fqdn: existing.fqdn,
              keyMaterial: yield* loadCustomDomainKeyMaterial(existing),
            });
          }
          yield* scheduleCustomDomainVerification({ customDomainId: existing.id });
        }
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
          try: () => dnsLookups.detectProvider(existing.fqdn),
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
                  }),
              ),
            );
        }
      }

      // Proof is asked for even when no Project holds the Domain any more: one whose holder
      // left while a claim was pending is still someone's DNS and DKIM key. Claims run side
      // by side: each has its own token, and the first proven takes the Domain from the
      // rest, so one claim never blocks another.
      //
      // The Domain may be going as this claim arrives: its last link was removed a moment
      // ago. Waiting on its row settles which came first. If the claim did, the Domain
      // stays; if the removal did, the Domain is gone and the FQDN is added as new. A held
      // Domain can still be unregistered, when its holder's registration failed, so the
      // claim reads that here and registers it.
      const claim = yield* db
        .transaction((tx) =>
          Effect.gen(function* () {
            const [held] = yield* tx
              .select({ id: customDomain.id })
              .from(customDomain)
              .where(eq(customDomain.id, existing.id))
              .for("key share");
            if (!held) {
              return;
            }
            yield* createOrgDomainLink({
              customDomainId: existing.id,
              db: tx,
              organizationId: input.organizationId,
              ownershipVerified: false,
            });
            const [registration] = yield* tx
              .select({ id: emailDomainRegistration.id })
              .from(emailDomainRegistration)
              .where(eq(emailDomainRegistration.customDomainId, existing.id));
            return { registered: registration !== undefined };
          }),
        )
        .pipe(
          Effect.mapError((error) => {
            switch (error._tag) {
              case "CustomDomainError":
                return error;
              default:
                return new CustomDomainError({
                  cause: error,
                  customDomainId: existing.id,
                  message: "Failed to link Project to custom domain.",
                  operation: "persist",
                  organizationId: input.organizationId,
                });
            }
          }),
        );

      if (claim) {
        // Before the registration, which can fail: a claim left without its check would
        // never lapse, and its link would keep the Domain for good.
        yield* scheduleOwnershipCheck({
          customDomainId: existing.id,
          organizationId: input.organizationId,
        });

        if (!claim.registered) {
          yield* registerCustomDomainIdentity({
            customDomainId: existing.id,
            db,
            fqdn: existing.fqdn,
            keyMaterial: yield* loadCustomDomainKeyMaterial(existing),
          });
        }

        yield* scheduleCustomDomainVerification({ customDomainId: existing.id });

        return { customDomainId: existing.id, kind: "claim" as const };
      }
      // The Domain was removed with its last link: the FQDN is added as new, below.
    }

    const crypto = yield* SymmetricCrypto;
    const keyMaterial = createDomainKeyMaterial();
    const encryptedPrivateKey = yield* crypto.encrypt(keyMaterial.dkimPrivateKey).pipe(
      Effect.mapError(
        (cause) =>
          new CustomDomainError({
            cause,
            message: "Failed to encrypt custom domain DKIM private key.",
            operation: "encrypt_key",
            organizationId: input.organizationId,
          }),
      ),
    );

    const detectedProvider = yield* Effect.tryPromise({
      catch: (cause) =>
        new CustomDomainError({
          cause,
          message: "Failed to detect custom domain DNS host.",
          operation: "create",
          organizationId: input.organizationId,
        }),
      try: () => dnsLookups.detectProvider(input.fqdn),
    });

    // The Domain and the Project's link land together, so a registration that fails after
    // this leaves the Domain with its holder, who finishes it by adding it again.
    const row = yield* db
      .transaction((tx) =>
        Effect.gen(function* () {
          const [inserted] = yield* tx
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
            .returning();
          if (inserted) {
            yield* createOrgDomainLink({
              customDomainId: inserted.id,
              db: tx,
              organizationId: input.organizationId,
              ownershipVerified: true,
            });
          }
          return inserted;
        }),
      )
      .pipe(
        Effect.mapError((error) => {
          switch (error._tag) {
            case "CustomDomainError":
              return error;
            default:
              return new CustomDomainError({
                cause: error,
                message: "Failed to insert custom domain.",
                operation: "persist",
                organizationId: input.organizationId,
              });
          }
        }),
      );
    if (!row) {
      return yield* new CustomDomainError({
        message: "Failed to insert custom domain.",
        operation: "persist",
        organizationId: input.organizationId,
      });
    }

    yield* registerCustomDomainIdentity({
      customDomainId: row.id,
      db,
      fqdn: input.fqdn,
      keyMaterial,
    });

    yield* scheduleCustomDomainVerification({ customDomainId: row.id });

    return { customDomainId: row.id, kind: "created" as const };
  });

/**
 * Writes a Domain's pause or unpause where `changes` matches, and tells the Project that
 * holds it (`domain.updated`) in the same transaction, only if a row changed. Claimants are
 * not told: the Domain is not theirs yet. False when the Domain does not exist.
 */
const setDomainPause = (
  tx: DatabaseTransaction,
  customDomainId: string,
  values: { readonly isPaused: boolean; readonly pausedReason: DomainPausedReason | null },
  changes: SQL | undefined,
) =>
  Effect.gen(function* () {
    const [changed] = yield* tx
      .update(customDomain)
      .set(values)
      .where(and(eq(customDomain.id, customDomainId), changes))
      .returning({
        id: customDomain.id,
        isPaused: customDomain.isPaused,
        pausedReason: customDomain.pausedReason,
        verificationStatus: customDomain.verificationStatus,
      });
    if (!changed) {
      const [existing] = yield* tx
        .select({ id: customDomain.id })
        .from(customDomain)
        .where(eq(customDomain.id, customDomainId));
      return existing !== undefined;
    }
    const holders = yield* tx
      .select({ organizationId: organizationDomain.organizationId })
      .from(organizationDomain)
      .where(
        and(
          eq(organizationDomain.customDomainId, customDomainId),
          eq(organizationDomain.ownershipVerificationStatus, "verified"),
        ),
      );
    yield* Effect.forEach(
      holders,
      ({ organizationId }) => emitDomainUpdated(tx, organizationId, changed),
      { discard: true },
    );
    return true;
  });

/**
 * A pause is the platform's act on a Domain, not its Project's: it names the Domain alone
 * and asks nothing of who holds it, so the caller is what decides who may (the api keeps it
 * to platform admins). Pausing a Domain that is already paused changes its reason, which is
 * how an admin takes over a pause Relayit made itself so that it is not lifted when SES
 * restores the Project.
 */
export const pauseCustomDomain = (input: PauseCustomDomainInput) =>
  Effect.gen(function* () {
    const db = yield* DB;

    const found = yield* db
      .transaction((tx) =>
        setDomainPause(
          tx,
          input.customDomainId,
          { isPaused: true, pausedReason: input.reason },
          sql`(not ${customDomain.isPaused} or ${customDomain.pausedReason} is distinct from ${input.reason})`,
        ),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to pause custom domain.",
              operation: "pause",
            }),
        ),
      );
    if (!found) {
      return yield* new CustomDomainNotFound({
        customDomainId: input.customDomainId,
        message: "Domain not found.",
      });
    }

    return { customDomainId: input.customDomainId, isPaused: true as const };
  });

export const unpauseCustomDomain = (input: UnpauseCustomDomainInput) =>
  Effect.gen(function* () {
    const db = yield* DB;

    const found = yield* db
      .transaction((tx) =>
        setDomainPause(
          tx,
          input.customDomainId,
          { isPaused: false, pausedReason: null },
          sql`${customDomain.isPaused}`,
        ),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to unpause custom domain.",
              operation: "unpause",
            }),
        ),
      );
    if (!found) {
      return yield* new CustomDomainNotFound({
        customDomainId: input.customDomainId,
        message: "Domain not found.",
      });
    }

    return { customDomainId: input.customDomainId, isPaused: false as const };
  });

/**
 * Detaches what Projects sent from a Domain they are no longer linked to, in the caller's
 * transaction, which holds the Domain's row. The row can outlive a Project's link, for the
 * Project that took the Domain by a claim or still has one pending, and what the leaving
 * Project sent is not theirs: each of its Deliveries stops referring to the row and records
 * the FQDN instead, and their events stop referring to it too. Found through the Delivery's
 * Message and App Environment, so only these Projects' rows move.
 *
 * Whoever writes a Delivery or an event naming a Domain takes its row first (`KEY SHARE`),
 * so none is written behind this.
 */
const detachDeliveries = (
  tx: DatabaseTransaction,
  input: {
    readonly customDomainId: string;
    readonly fqdn: string;
    readonly organizationIds: readonly string[];
  },
) =>
  Effect.gen(function* () {
    if (input.organizationIds.length === 0) {
      return;
    }
    const detached = yield* tx
      .update(emailDelivery)
      .set({ customDomainId: null, removedDomainFqdn: input.fqdn })
      .where(
        and(
          eq(emailDelivery.customDomainId, input.customDomainId),
          inArray(
            emailDelivery.messageId,
            tx
              .select({ id: message.id })
              .from(message)
              .innerJoin(
                organizationAppEnvironment,
                eq(organizationAppEnvironment.id, message.organizationAppEnvironmentId),
              )
              .where(inArray(organizationAppEnvironment.organizationId, input.organizationIds)),
          ),
        ),
      )
      .returning({ id: emailDelivery.id });
    if (detached.length === 0) {
      return;
    }
    yield* tx
      .update(emailDeliveryEvent)
      .set({ customDomainId: null })
      .where(
        and(
          eq(emailDeliveryEvent.customDomainId, input.customDomainId),
          inArray(
            emailDeliveryEvent.emailDeliveryId,
            detached.map(({ id }) => id),
          ),
        ),
      );
  });

/**
 * A proven claim takes the Domain: its link is marked proven and every other Project's link
 * goes, in one transaction holding the Domain's row. A failure leaves the claim unproven to
 * be checked again, and of two claims proven at once the second finds its link gone. False
 * when it is: another claim took the Domain first. The SES registration, DNS records and
 * DKIM key stay, since they belong to the Domain, not the Project; what the Projects losing
 * it sent from it does not, and is detached from it here.
 */
export const completeDomainClaimTransfer = (input: {
  readonly customDomainId: string;
  readonly db: Database;
  readonly organizationId: string;
  readonly proof: Pick<
    OrganizationDomainInsert,
    | "ownershipBackoffLevel"
    | "ownershipEverVerifiedAt"
    | "ownershipLastCheckedAt"
    | "ownershipNextVerifyAt"
  >;
}) =>
  input.db
    .transaction((tx) =>
      Effect.gen(function* () {
        const [domain] = yield* tx
          .select({ fqdn: customDomain.fqdn })
          .from(customDomain)
          .where(eq(customDomain.id, input.customDomainId))
          .for("update");
        const [proven] = yield* tx
          .update(organizationDomain)
          .set({ ...input.proof, ownershipVerificationStatus: "verified" })
          .where(
            and(
              eq(organizationDomain.customDomainId, input.customDomainId),
              eq(organizationDomain.organizationId, input.organizationId),
            ),
          )
          .returning({ organizationId: organizationDomain.organizationId });
        if (!(proven && domain)) {
          return false;
        }
        const lost = yield* tx
          .delete(organizationDomain)
          .where(
            and(
              eq(organizationDomain.customDomainId, input.customDomainId),
              ne(organizationDomain.organizationId, input.organizationId),
            ),
          )
          .returning({ organizationId: organizationDomain.organizationId });
        yield* detachDeliveries(tx, {
          customDomainId: input.customDomainId,
          fqdn: domain.fqdn,
          organizationIds: lost.map(({ organizationId }) => organizationId),
        });
        return true;
      }),
    )
    .pipe(
      Effect.mapError(
        (cause) =>
          new CustomDomainError({
            cause,
            customDomainId: input.customDomainId,
            message: "Failed to complete the Domain claim transfer.",
            operation: "claim",
            organizationId: input.organizationId,
          }),
      ),
    );

/**
 * Removes a Domain no Project is linked to, in the caller's transaction: its DNS records,
 * its registration and its row, with the job that deletes its SES identity. False when a
 * Project is linked, so a claim that arrived first keeps the Domain; the row is held, so
 * one arriving now waits for this to commit.
 *
 * What was sent from the Domain stays with the Project that sent it, so the FQDN added
 * again is a new Domain with none of this history. A Project's Deliveries are detached as
 * its link goes (`detachDeliveries`); the update here takes any still naming the row, of a
 * Project whose link went where no code saw it, and their events lose the reference by
 * their foreign key.
 */
const removeUnlinkedDomain = (tx: DatabaseTransaction, customDomainId: string) =>
  Effect.gen(function* () {
    const jobs = yield* Jobs;
    const [domain] = yield* tx
      .select({ fqdn: customDomain.fqdn })
      .from(customDomain)
      .where(eq(customDomain.id, customDomainId))
      .for("update");
    if (!domain) {
      return false;
    }
    const [linked] = yield* tx
      .select({ organizationId: organizationDomain.organizationId })
      .from(organizationDomain)
      .where(eq(organizationDomain.customDomainId, customDomainId))
      .limit(1);
    if (linked) {
      return false;
    }

    const [registration] = yield* tx
      .delete(emailDomainRegistration)
      .where(eq(emailDomainRegistration.customDomainId, customDomainId))
      .returning({ region: emailDomainRegistration.region });
    // Enqueued even without a registration: an add that failed after SES made the identity
    // recorded none, always in the default region, and SES takes deleting no identity as done.
    yield* jobs.enqueue(
      emailDeleteDomainIdentityJob,
      { fqdn: domain.fqdn, region: registration?.region ?? null },
      tx,
    );
    // A Domain's records are the customer's to publish and exist only as these rows.
    yield* tx.delete(emailDnsRecord).where(eq(emailDnsRecord.customDomainId, customDomainId));

    yield* tx
      .update(emailDelivery)
      .set({ customDomainId: null, removedDomainFqdn: domain.fqdn })
      .where(eq(emailDelivery.customDomainId, customDomainId));
    yield* tx.delete(customDomain).where(eq(customDomain.id, customDomainId));
    return true;
  });

/**
 * Removes a Project's link to a Domain and, when it was the last, the Domain with it.
 * `unprovenOnly` leaves a link that has been proven. The Domain's row is taken before the
 * link, as a claim transfer takes them, so the two never wait on each other. What the
 * Project sent from the Domain is detached from it, whether or not the row stays for
 * another Project's claim.
 */
export const removeDomainLink = (input: {
  readonly customDomainId: string;
  readonly db: Database;
  readonly organizationId: string;
  readonly unprovenOnly?: boolean;
}) =>
  input.db
    .transaction((tx) =>
      Effect.gen(function* () {
        const [domain] = yield* tx
          .select({ fqdn: customDomain.fqdn })
          .from(customDomain)
          .where(eq(customDomain.id, input.customDomainId))
          .for("update");
        const [unlinked] = yield* tx
          .delete(organizationDomain)
          .where(
            and(
              eq(organizationDomain.organizationId, input.organizationId),
              eq(organizationDomain.customDomainId, input.customDomainId),
              input.unprovenOnly
                ? eq(organizationDomain.ownershipVerificationStatus, "not_verified")
                : undefined,
            ),
          )
          .returning({ organizationId: organizationDomain.organizationId });
        if (!(unlinked && domain)) {
          return { unlinked: false as const };
        }
        yield* detachDeliveries(tx, {
          customDomainId: input.customDomainId,
          fqdn: domain.fqdn,
          organizationIds: [input.organizationId],
        });
        return {
          domainRemoved: yield* removeUnlinkedDomain(tx, input.customDomainId),
          unlinked: true as const,
        };
      }),
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
          }),
      ),
    );

/**
 * Removes the Domains left without a link, among `among` or of them all. Deleting a Project
 * takes its links in the database, where no code sees the last one go, so this follows a
 * Project's deletion with the Domains it was linked to, and runs over every Domain when
 * the worker starts. One that fails is logged and the rest still go.
 */
export const removeUnlinkedDomains = (among?: readonly string[]) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const unlinked = yield* db
      .select({ id: customDomain.id })
      .from(customDomain)
      .where(
        and(
          among ? inArray(customDomain.id, among) : undefined,
          notExists(
            db
              .select({ organizationId: organizationDomain.organizationId })
              .from(organizationDomain)
              .where(eq(organizationDomain.customDomainId, customDomain.id)),
          ),
        ),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              message: "Failed to list Domains without a link.",
              operation: "delete",
            }),
        ),
      );

    // One Domain that can't be removed is left for the next run, not in the way of the rest.
    yield* Effect.forEach(
      unlinked,
      ({ id }) =>
        db
          .transaction((tx) => removeUnlinkedDomain(tx, id))
          .pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Failed to remove a Domain without a link", {
                cause,
                customDomainId: id,
              }),
            ),
          ),
      { discard: true },
    );
  });

/**
 * Stops the ownership check of a link that has been removed. The removal has happened by
 * now and the check ends itself when it finds its link gone, so a failure is only logged.
 */
const cancelOwnershipCheck = (link: {
  readonly customDomainId: string;
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    const jobs = yield* Jobs;
    yield* jobs.cancel(emailVerifyOwnershipJob, link).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Ownership check of a removed link left scheduled", {
          cause,
          ...link,
        }),
      ),
    );
  });

/**
 * Follows up a deleted Project with the links it had, read before it went: the Domains it
 * left without a link are removed, then the ownership checks of its unproven claims are
 * cancelled.
 */
export const removeDeletedProjectDomains = (input: {
  readonly links: readonly Pick<
    OrganizationDomain,
    "customDomainId" | "ownershipVerificationStatus"
  >[];
  readonly organizationId: string;
}) =>
  Effect.gen(function* () {
    yield* removeUnlinkedDomains(input.links.map((link) => link.customDomainId));

    yield* Effect.forEach(
      input.links.filter((link) => link.ownershipVerificationStatus !== "verified"),
      ({ customDomainId }) =>
        cancelOwnershipCheck({ customDomainId, organizationId: input.organizationId }),
      { discard: true },
    );
  });

/**
 * Unlink a Project from a Custom Domain and stop the ownership check of its claim. When no
 * other Project is linked, the Domain goes too.
 */
export const deleteCustomDomain = (input: DeleteCustomDomainInput) =>
  Effect.gen(function* () {
    const db = yield* DB;

    const removed = yield* removeDomainLink({ ...input, db });
    if (!removed.unlinked) {
      return yield* new CustomDomainError({
        customDomainId: input.customDomainId,
        message: "Domain is not linked to this Project.",
        operation: "persist",
        organizationId: input.organizationId,
      });
    }

    yield* cancelOwnershipCheck(input);

    return { deleted: removed.domainRemoved };
  });
