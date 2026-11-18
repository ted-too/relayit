import { describe, expect, it } from "@effect/vitest";
import { Jobs, type JobsService } from "@repo/jobs";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
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
});
