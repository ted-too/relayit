import { describe, expect, test } from "bun:test";
import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import {
  createPlatformProvider,
  deletePlatformProvider,
  PlatformProviderError,
} from "./providers.server";

const sealed = { encrypted: {}, unencrypted: {} } as never;

const platformProvider = {
  channelType: "email" as const,
  createdAt: new Date("2026-01-01"),
  credentials: sealed,
  id: "prov_1",
  isDefault: true,
  name: "eu-central-1",
  organizationId: null,
  productId: "ses",
  scope: "platform" as const,
  updatedAt: new Date("2026-01-01"),
  vendorId: "aws",
};

const vaultLive = Layer.succeed(ProviderCredentialsVault, {
  open: () => Effect.die("unused"),
  seal: () => Effect.succeed(sealed),
} as never);

describe("createPlatformProvider", () => {
  test("skips sandbox provision when Cloudflare is not configured", () => {
    const db = {
      query: {
        provider: {
          findFirst: () => Effect.succeed(null),
        },
      },
      insert: () => ({
        values: () => ({
          returning: () => Effect.succeed([platformProvider]),
        }),
      }),
      update: () => ({
        set: () => ({
          where: () => Effect.void,
        }),
      }),
    };

    return Effect.runPromise(
      createPlatformProvider({
        credentials: {
          encrypted: { accessKeyId: "AKIA", secretAccessKey: "secret" },
          unencrypted: { region: "eu-central-1" },
        },
        name: "eu-central-1",
        productId: "ses",
        sandboxCloudflare: null,
        vendorId: "aws",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(Layer.succeed(DB, db as never), vaultLive)
        ),
        Effect.map((result) => {
          expect(result.id).toBe("prov_1");
          return result;
        })
      )
    );
  });
});

describe("deletePlatformProvider", () => {
  test("refuses while a custom Domain pairing still references the Provider", () => {
    const db = {
      query: {
        provider: {
          findFirst: () => Effect.succeed(platformProvider),
        },
        emailDomainProviderIdentity: {
          findFirst: () => Effect.succeed({ id: "epid_custom" }),
        },
      },
    };

    return Effect.runPromise(
      deletePlatformProvider("prov_1").pipe(
        Effect.provide(Layer.succeed(DB, db as never)),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toBeInstanceOf(PlatformProviderError);
          expect(error).toMatchObject({
            code: "in_use",
            message: "Managed backend is still referenced by a Domain pairing.",
          });
          return error;
        })
      )
    );
  });
});
