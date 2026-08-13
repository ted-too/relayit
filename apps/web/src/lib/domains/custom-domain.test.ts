import { describe, expect, test } from "bun:test";
import {
  EmailManagedDns,
  type EmailManagedDnsService,
} from "@repo/channels/email/managed-dns";
import {
  EmailProviderRegistry,
  type EmailProviderRegistryService,
} from "@repo/channels/email/provider-registry";
import { Jobs, type JobsService } from "@repo/jobs";
import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import {
  createCustomDomainForProject,
  pauseCustomDomainForProject,
} from "./custom-domain.server";

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

const provideDb = (db: unknown) =>
  Layer.merge(Layer.succeed(DB, db as never), unusedCreateServices);

describe("createCustomDomainForProject", () => {
  test("rejects when the Provider is missing", () => {
    const db = {
      query: {
        provider: {
          findFirst: () => Effect.succeed(null),
        },
      },
    };

    return Effect.runPromise(
      createCustomDomainForProject({
        fqdn: "acme.test",
        organizationId: "org_1",
        providerId: "prov_missing",
      }).pipe(
        Effect.provide(provideDb(db)),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            code: "not_found",
            message: "Email Provider not found.",
          });
          return error;
        })
      )
    );
  });
});

describe("pauseCustomDomainForProject", () => {
  test("maps missing Project link to not_found", () => {
    const db = {
      query: {
        organizationDomain: {
          findFirst: () => Effect.succeed(null),
        },
      },
    };

    return Effect.runPromise(
      pauseCustomDomainForProject({
        customDomainId: "dom_1",
        organizationId: "org_1",
        reason: "manual_admin_pause",
      }).pipe(
        Effect.provide(Layer.succeed(DB, db as never)),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            code: "not_found",
          });
          return error;
        })
      )
    );
  });
});
