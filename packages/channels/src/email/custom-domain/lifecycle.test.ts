import { describe, expect, test } from "bun:test";
import { Jobs, type JobsService } from "@repo/jobs";
import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import { EmailManagedDns, type EmailManagedDnsService } from "../managed-dns";
import {
  EmailProviderRegistry,
  type EmailProviderRegistryService,
} from "../provider-registry";
import {
  createCustomDomain,
  pauseCustomDomain,
  unpauseCustomDomain,
} from "./lifecycle";

const unsupported = () => Effect.die("unused");

const unusedCreateServices = Layer.mergeAll(
  Layer.succeed(EmailManagedDns, {
    cloudflareEnabled: false,
    reconcile: unsupported,
    remove: unsupported,
  } satisfies EmailManagedDnsService),
  Layer.succeed(EmailProviderRegistry, {
    get: unsupported,
  } satisfies EmailProviderRegistryService),
  Layer.succeed(Jobs, {
    cancel: unsupported,
    enqueue: unsupported,
    schedule: unsupported,
  } satisfies JobsService),
  Layer.succeed(ProviderCredentialsVault, {
    open: unsupported,
    seal: unsupported,
  } as never),
  Layer.succeed(SymmetricCrypto, {
    decrypt: unsupported,
    encrypt: unsupported,
  } as never)
);

describe("pauseCustomDomain / unpauseCustomDomain", () => {
  test("rejects pause when the Project is not linked to the domain", () => {
    const db: any = {
      query: {
        organizationDomain: {
          findFirst: () => Effect.succeed(null),
        },
      },
    };

    return Effect.runPromise(
      pauseCustomDomain({
        customDomainId: "dom_1",
        organizationId: "org_1",
        reason: "manual_admin_pause",
      }).pipe(
        Effect.provide(Layer.succeed(DB, db)),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            _tag: "CustomDomainError",
            message: "Domain is not linked to this Project.",
          });
          return error;
        })
      )
    );
  });

  test("pauses and unpauses a linked custom domain", () => {
    const updates: unknown[] = [];
    const db: any = {
      query: {
        organizationDomain: {
          findFirst: () =>
            Effect.succeed({
              customDomainId: "dom_1",
              organizationId: "org_1",
            }),
        },
      },
      update: () => ({
        set: (values: unknown) => ({
          where: () => {
            updates.push(values);
            return Effect.void;
          },
        }),
      }),
    };

    return Effect.runPromise(
      Effect.gen(function* () {
        const paused = yield* pauseCustomDomain({
          customDomainId: "dom_1",
          organizationId: "org_1",
          reason: "bad_reputation",
        });
        expect(paused).toEqual({ customDomainId: "dom_1", isPaused: true });

        const unpaused = yield* unpauseCustomDomain({
          customDomainId: "dom_1",
          organizationId: "org_1",
        });
        expect(unpaused).toEqual({ customDomainId: "dom_1", isPaused: false });
        expect(updates).toEqual([
          { isPaused: true, pausedReason: "bad_reputation" },
          { isPaused: false, pausedReason: null },
        ]);
      }).pipe(Effect.provide(Layer.succeed(DB, db)))
    );
  });
});

describe("createCustomDomain claim guard", () => {
  test("rejects a second pending claim on a held FQDN", () => {
    const db: any = {
      query: {
        customDomain: {
          findFirst: () =>
            Effect.succeed({
              fqdn: "acme.test",
              id: "dom_held",
              organizations: [
                {
                  organizationId: "org_owner",
                  ownershipVerificationStatus: "verified",
                },
                {
                  organizationId: "org_pending",
                  ownershipVerificationStatus: "not_verified",
                },
              ],
              providerIdentities: [],
            }),
        },
      },
    };

    return Effect.runPromise(
      createCustomDomain({
        fqdn: "acme.test",
        organizationId: "org_claimant",
        provider: {
          channelType: "email",
          credentials: { ciphertext: "x", keyVersion: 1, nonce: "n" },
          id: "prov_1",
          productId: "ses",
          scope: "platform",
          vendorId: "aws",
        } as never,
      }).pipe(
        Effect.provide(
          Layer.merge(Layer.succeed(DB, db), unusedCreateServices)
        ),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            message:
              "Another Project already has a pending claim on this domain.",
            operation: "claim",
          });
          return error;
        })
      )
    );
  });

  test("returns existing when the Project is already linked", () => {
    const db: any = {
      query: {
        customDomain: {
          findFirst: () =>
            Effect.succeed({
              fqdn: "acme.test",
              id: "dom_1",
              organizations: [
                {
                  organizationId: "org_1",
                  ownershipVerificationStatus: "verified",
                },
              ],
              providerIdentities: [],
            }),
        },
      },
    };

    return Effect.runPromise(
      createCustomDomain({
        fqdn: "acme.test",
        organizationId: "org_1",
        provider: {
          id: "prov_1",
          productId: "ses",
          scope: "platform",
          vendorId: "aws",
        } as never,
      }).pipe(
        Effect.provide(
          Layer.merge(Layer.succeed(DB, db), unusedCreateServices)
        ),
        Effect.map((result) => {
          expect(result).toEqual({
            customDomainId: "dom_1",
            kind: "existing",
          });
          return result;
        })
      )
    );
  });
});
