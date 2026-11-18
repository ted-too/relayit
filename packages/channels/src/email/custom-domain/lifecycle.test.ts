import { describe, expect, it } from "@effect/vitest";
import { Jobs, type JobsService } from "@repo/jobs";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Fiber, Layer } from "effect";
import { TestClock } from "effect/testing";
import { EmailBackend, type EmailBackendService } from "../backend";
import { EmailManagedDns, type EmailManagedDnsService } from "../managed-dns";
import { createCustomDomain } from "./lifecycle";

const unsupported = () => Effect.die("unused");

const backend = (overrides: Partial<EmailBackendService> = {}) =>
  Layer.succeed(EmailBackend, {
    createIdentity: unsupported,
    defaultRegion: "eu-central-1",
    deleteIdentity: unsupported,
    ensureInfrastructure: unsupported,
    getIdentityStatus: unsupported,
    getProjectSendingStatus: unsupported,
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

  it.effect("gives up an SES registration that never answers", () => {
    const domain = {
      dkimPrivateKey: "sealed",
      dkimPublicKey: "public",
      dkimSelector: "relayit",
      fqdn: "acme.test",
      id: "dom_1",
      lastCheckedAt: null,
      organizations: [{ organizationId: "org_1", ownershipVerificationStatus: "verified" }],
      registration: null,
    };
    // Its link, then no registration.
    const limited: unknown[][] = [[{ organizationId: "org_1" }], []];
    const db: any = {
      query: { customDomain: { findFirst: () => Effect.succeed(domain) } },
      // The Domain is still there, linked and unregistered when registration takes its locks.
      transaction: (run: (tx: unknown) => Effect.Effect<unknown, unknown>) =>
        run({
          execute: () => Effect.void,
          select: () => ({
            from: () => ({
              where: () => ({
                for: () => Effect.succeed([{ id: "dom_1" }]),
                limit: () => Effect.succeed(limited.shift() ?? []),
              }),
            }),
          }),
        }),
    };

    return Effect.gen(function* () {
      const adding = yield* Effect.forkChild(
        Effect.flip(createCustomDomain({ fqdn: "acme.test", organizationId: "org_1" })),
      );
      yield* TestClock.adjust("30 seconds");

      expect(yield* Fiber.join(adding)).toMatchObject({
        _tag: "CustomDomainError",
        message: "SES did not answer in time while registering the domain.",
        operation: "register_identity",
      });
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(DB, db),
          Layer.succeed(EmailManagedDns, {
            cloudflareEnabled: false,
            reconcile: () => Effect.void,
            remove: unsupported,
          } satisfies EmailManagedDnsService),
          backend({ createIdentity: () => Effect.never }),
          Layer.succeed(Jobs, {
            cancel: unsupported,
            enqueue: unsupported,
            schedule: unsupported,
          } satisfies JobsService),
          Layer.succeed(SymmetricCrypto, {
            decrypt: () => Effect.succeed("private"),
            encrypt: unsupported,
          } as never),
        ),
      ),
    );
  });
});
