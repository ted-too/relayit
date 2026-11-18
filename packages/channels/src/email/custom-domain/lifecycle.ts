import { Jobs } from "@repo/jobs";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { type Database, type DatabaseExecutor, DB } from "@repo/persistence/db/effect";
import {
  type CustomDomain,
  customDomain,
  type DomainPausedReason,
  emailDnsRecord,
  emailDomainRegistration,
  type OrganizationDomainInsert,
  organizationDomain,
} from "@repo/persistence/db/schema";
import { and, eq, ne } from "drizzle-orm";
import { Data, Effect } from "effect";
import { EmailBackend } from "../backend";
import type { DomainKeyMaterial } from "../dkim";
import { createDomainKeyMaterial } from "../dkim";
import { DnsLookups } from "../dns-lookups";
import { EmailManagedDns } from "../managed-dns";
import { emailVerifyCustomDomainJob, emailVerifyOwnershipJob } from "../verification/jobs";
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

/** The Project holds the Domain: its link is ownership-verified, not a claim. */
const assertDomainHolder = (input: {
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
            }),
        ),
      );

    if (!link) {
      return yield* new CustomDomainError({
        customDomainId: input.customDomainId,
        message: "Domain is not linked to this Project.",
        operation: "persist",
        organizationId: input.organizationId,
      });
    }

    if (link.ownershipVerificationStatus !== "verified") {
      return yield* new CustomDomainError({
        customDomainId: input.customDomainId,
        message: "Prove ownership of this Domain before changing it.",
        operation: "claim",
        organizationId: input.organizationId,
      });
    }

    return link;
  });

/**
 * Records the Domain's root DNS records, registers it with SES in the default region and
 * records where. Each step is safe to repeat, so a retry finishes a registration that failed.
 */
const registerCustomDomainIdentity = (input: {
  readonly customDomainId: string;
  readonly db: DatabaseExecutor;
  readonly fqdn: string;
  readonly keyMaterial: DomainKeyMaterial;
}) =>
  Effect.gen(function* () {
    const backend = yield* EmailBackend;
    const managedDns = yield* EmailManagedDns;
    const region = backend.defaultRegion;

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

    yield* input.db
      .insert(emailDomainRegistration)
      .values({
        customDomainId: input.customDomainId,
        region,
        verificationStatus: "not_verified",
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: input.customDomainId,
              message: "Failed to record the custom domain registration.",
              operation: "persist",
            }),
        ),
      );
  });

const scheduleCustomDomainVerification = (input: {
  readonly customDomainId: string;
  readonly ownership?: {
    readonly organizationId: string;
  };
}) =>
  Effect.gen(function* () {
    const jobs = yield* Jobs;
    const runAt = Date.now();

    yield* jobs
      .schedule(emailVerifyCustomDomainJob, { customDomainId: input.customDomainId }, runAt)
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

    if (input.ownership) {
      yield* jobs
        .schedule(
          emailVerifyOwnershipJob,
          {
            customDomainId: input.customDomainId,
            organizationId: input.ownership.organizationId,
          },
          runAt,
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
              }),
          ),
        );
    }
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
 * Add a Domain to a Project. A new FQDN is the Project's at once. One already added, by
 * another Project or by none that still holds it, becomes a claim the Project proves with
 * a TXT record before it may send from or change the Domain.
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
        // A first add that failed after writing the Domain left it unregistered or never
        // checked; adding it again finishes the job.
        if (ownLink.ownershipVerificationStatus === "verified" && existing.lastCheckedAt === null) {
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
      // was deleted, or left while a claim was pending, is still someone's DNS and DKIM key.
      // Claims run side by side: each has its own token, and the first proven takes the
      // Domain from the rest, so one claim never blocks another.
      yield* createOrgDomainLink({
        customDomainId: existing.id,
        db,
        organizationId: input.organizationId,
        ownershipVerified: false,
      });

      if (!existing.registration) {
        yield* registerCustomDomainIdentity({
          customDomainId: existing.id,
          db,
          fqdn: existing.fqdn,
          keyMaterial: yield* loadCustomDomainKeyMaterial(existing),
        });
      }

      yield* scheduleCustomDomainVerification({
        customDomainId: existing.id,
        ownership: { organizationId: input.organizationId },
      });

      return { customDomainId: existing.id, kind: "claim" as const };
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

export const pauseCustomDomain = (input: PauseCustomDomainInput) =>
  Effect.gen(function* () {
    yield* assertDomainHolder(input);
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
            }),
        ),
      );

    return { customDomainId: input.customDomainId, isPaused: true as const };
  });

export const unpauseCustomDomain = (input: UnpauseCustomDomainInput) =>
  Effect.gen(function* () {
    yield* assertDomainHolder(input);
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
            }),
        ),
      );

    return { customDomainId: input.customDomainId, isPaused: false as const };
  });

/**
 * A proven claim takes the Domain: its link is marked proven and every other Project's link
 * goes, in one transaction holding the Domain's row. A failure leaves the claim unproven to
 * be checked again, and of two claims proven at once the second finds its link gone. False
 * when it is: another claim took the Domain first. The SES registration and DNS records
 * stay, since they belong to the Domain, not the Project.
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
        yield* tx
          .select({ id: customDomain.id })
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
        if (!proven) {
          return false;
        }
        yield* tx
          .delete(organizationDomain)
          .where(
            and(
              eq(organizationDomain.customDomainId, input.customDomainId),
              ne(organizationDomain.organizationId, input.organizationId),
            ),
          );
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
 * Unlink a Project from a Custom Domain. When no other Projects remain, tear
 * down its SES identity, managed DNS, DNS rows, and the domain row (its registration
 * goes with it).
 */
export const deleteCustomDomain = (input: DeleteCustomDomainInput) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const managedDns = yield* EmailManagedDns;
    const backend = yield* EmailBackend;

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
              registration: true,
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
            }),
        ),
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
          eq(organizationDomain.customDomainId, input.customDomainId),
        ),
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

    const remainingRefs = domain.organizations.filter(
      (organization) => organization.organizationId !== input.organizationId,
    ).length;

    if (remainingRefs > 0) {
      return { deleted: false as const };
    }

    if (domain.registration) {
      yield* backend.deleteIdentity({ fqdn: domain.fqdn, region: domain.registration.region }).pipe(
        Effect.mapError(
          (cause) =>
            new CustomDomainError({
              cause,
              customDomainId: domain.id,
              message: "Failed to delete the SES identity.",
              operation: "delete",
            }),
        ),
      );
    }

    yield* managedDns.remove(customDomainIdentityDnsOwner(domain.id)).pipe(
      Effect.mapError(
        (cause) =>
          new CustomDomainError({
            cause,
            customDomainId: domain.id,
            message: "Failed to remove identity DNS.",
            operation: "delete",
          }),
      ),
    );

    yield* managedDns.remove(customDomainRootDnsOwner(domain.id)).pipe(
      Effect.mapError(
        (cause) =>
          new CustomDomainError({
            cause,
            customDomainId: domain.id,
            message: "Failed to remove root DNS.",
            operation: "delete",
          }),
      ),
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
            }),
        ),
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
            }),
        ),
      );

    return { deleted: true as const };
  });
