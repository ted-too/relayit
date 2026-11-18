import { describe, expect, it } from "@effect/vitest";
import { Jobs, type JobsService } from "@repo/jobs";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import { EmailBackend, type EmailBackendService } from "../backend";
import { EmailManagedDns, type EmailManagedDnsService } from "../managed-dns";
import { createCustomDomain, pauseCustomDomain, unpauseCustomDomain } from "./lifecycle";

const unsupported = () => Effect.die("unused");

const backend = (overrides: Partial<EmailBackendService> = {}) =>
  Layer.succeed(EmailBackend, {
    createIdentity: unsupported,
    defaultRegion: "eu-central-1",
    deleteIdentity: unsupported,
    ensureInfrastructure: unsupported,
    getIdentityStatus: unsupported,
    send: unsupported,
    ...overrides,
  } satisfies EmailBackendService);

const unusedCreateServices = Layer.mergeAll(
  Layer.succeed(EmailManagedDns, {
    cloudflareEnabled: false,
    reconcile: unsupported,
    remove: unsupported,
  } satisfies EmailManagedDnsService),
  backend(),
  Layer.succeed(Jobs, {
    cancel: unsupported,
    enqueue: unsupported,
    schedule: unsupported,
  } satisfies JobsService),
  Layer.succeed(SymmetricCrypto, {
    decrypt: unsupported,
    encrypt: unsupported,
  } as never),
);

describe("pauseCustomDomain / unpauseCustomDomain", () => {
  it.effect("rejects pause when the Project is not linked to the domain", () => {
    const db: any = {
      query: {
        organizationDomain: {
          findFirst: () => Effect.succeed(null),
        },
      },
    };

    return pauseCustomDomain({
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
      }),
    );
  });

  it.effect("refuses pause and unpause from a Project whose claim is not proven", () => {
    const db: any = {
      query: {
        organizationDomain: {
          findFirst: () =>
            Effect.succeed({
              customDomainId: "dom_1",
              organizationId: "org_claimant",
              ownershipVerificationStatus: "not_verified",
            }),
        },
      },
      update: () => Effect.die("changed the holder's Domain"),
    };
    const input = { customDomainId: "dom_1", organizationId: "org_claimant" };

    return Effect.gen(function* () {
      const refusal = {
        _tag: "CustomDomainError",
        message: "Prove ownership of this Domain before changing it.",
        operation: "claim",
      };
      expect(
        yield* Effect.flip(pauseCustomDomain({ ...input, reason: "manual_admin_pause" })),
      ).toMatchObject(refusal);
      expect(yield* Effect.flip(unpauseCustomDomain(input))).toMatchObject(refusal);
    }).pipe(Effect.provide(Layer.succeed(DB, db)));
  });

  it.effect("pauses and unpauses a linked custom domain", () => {
    const updates: unknown[] = [];
    const db: any = {
      query: {
        organizationDomain: {
          findFirst: () =>
            Effect.succeed({
              customDomainId: "dom_1",
              organizationId: "org_1",
              ownershipVerificationStatus: "verified",
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

    return Effect.gen(function* () {
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
    }).pipe(Effect.provide(Layer.succeed(DB, db)));
  });
});

describe("createCustomDomain", () => {
  it.effect("returns existing when the Project is already linked", () => {
    const db: any = {
      query: {
        customDomain: {
          findFirst: () =>
            Effect.succeed({
              fqdn: "acme.test",
              id: "dom_1",
              lastCheckedAt: new Date(),
              organizations: [
                {
                  organizationId: "org_1",
                  ownershipVerificationStatus: "verified",
                },
              ],
              registration: { region: "eu-central-1" },
            }),
        },
      },
    };

    return createCustomDomain({
      fqdn: "acme.test",
      organizationId: "org_1",
    }).pipe(
      Effect.provide(Layer.merge(Layer.succeed(DB, db), unusedCreateServices)),
      Effect.map((result) => {
        expect(result).toEqual({
          customDomainId: "dom_1",
          kind: "existing",
        });
        return result;
      }),
    );
  });
});
