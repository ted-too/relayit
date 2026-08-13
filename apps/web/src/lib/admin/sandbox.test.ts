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
  attachSandboxProviderForOps,
  createSandboxDomainForOps,
  SandboxAdminError,
} from "./sandbox.server";

const unsupported = () => Effect.die("unused");

const unusedProvisionServices = Layer.mergeAll(
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
  Layer.merge(Layer.succeed(DB, db as never), unusedProvisionServices);

describe("createSandboxDomainForOps", () => {
  test("rejects when Cloudflare zone is not configured", () =>
    Effect.runPromise(
      createSandboxDomainForOps({
        cloudflareZoneId: null,
        providerId: "prov_1",
        rootDomain: "snd.example.test",
      }).pipe(
        Effect.provide(provideDb({})),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toBeInstanceOf(SandboxAdminError);
          expect(error).toMatchObject({
            code: "unavailable",
          });
          return error;
        })
      )
    ));

  test("rejects when the managed Provider is missing", () => {
    const db = {
      query: {
        provider: {
          findFirst: () => Effect.succeed(null),
        },
      },
    };

    return Effect.runPromise(
      createSandboxDomainForOps({
        cloudflareZoneId: "zone_1",
        providerId: "prov_missing",
        rootDomain: "snd.example.test",
      }).pipe(
        Effect.provide(provideDb(db)),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            code: "not_found",
            message: "Managed email Provider not found.",
          });
          return error;
        })
      )
    );
  });

  test("surfaces the provision failure message", () => {
    const db = {
      query: {
        provider: {
          findFirst: () =>
            Effect.succeed({
              channelType: "email",
              id: "prov_1",
              scope: "platform",
            }),
        },
      },
    };

    return Effect.runPromise(
      createSandboxDomainForOps({
        cloudflareZoneId: "zone_1",
        providerId: "prov_1",
        rootDomain: "snd.example.test",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(DB, db as never),
            Layer.succeed(EmailManagedDns, {
              cloudflareEnabled: true,
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
              encrypt: () =>
                Effect.fail(new Error("encrypt failed")) as never,
            } as never)
          )
        ),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            code: "failed",
            message: "Failed to encrypt sandbox DKIM private key.",
          });
          return error;
        })
      )
    );
  });

  test("rejects project-scoped Providers", () => {
    const db = {
      query: {
        provider: {
          findFirst: () =>
            Effect.succeed({
              channelType: "email",
              id: "prov_byo",
              scope: "project",
            }),
        },
      },
    };

    return Effect.runPromise(
      createSandboxDomainForOps({
        cloudflareZoneId: "zone_1",
        providerId: "prov_byo",
        rootDomain: "snd.example.test",
      }).pipe(
        Effect.provide(provideDb(db)),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({ code: "not_found" });
          return error;
        })
      )
    );
  });
});

describe("attachSandboxProviderForOps", () => {
  test("rejects when the sandbox root is missing", () => {
    const db = {
      query: {
        provider: {
          findFirst: () =>
            Effect.succeed({
              channelType: "email",
              id: "prov_1",
              scope: "platform",
            }),
        },
        sandboxDomain: {
          findFirst: () => Effect.succeed(null),
        },
      },
    };

    return Effect.runPromise(
      attachSandboxProviderForOps({
        providerId: "prov_1",
        sandboxDomainId: "snd_missing",
      }).pipe(
        Effect.provide(provideDb(db)),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            code: "not_found",
            message: "Sandbox Domain not found.",
          });
          return error;
        })
      )
    );
  });
});
