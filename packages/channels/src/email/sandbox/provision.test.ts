import { describe, expect, test } from "bun:test";
import { Jobs, type JobsService } from "@repo/jobs";
import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB } from "@repo/persistence/db/effect";
import type { Provider } from "@repo/persistence/db/schema";
import { Effect, Layer } from "effect";
import { EmailManagedDns, type EmailManagedDnsService } from "../managed-dns";
import {
  EmailProviderRegistry,
  type EmailProviderRegistryService,
} from "../provider-registry";
import {
  ensureSandboxForProvider,
  removeSandboxProviderIdentity,
} from "./provision";

const provider = {
  id: "prov_1",
} as Provider;

const unused = () => Effect.die("unused");

const unusedServices = Layer.mergeAll(
  Layer.succeed(DB, {} as never),
  Layer.succeed(EmailManagedDns, {
    cloudflareEnabled: false,
    reconcile: unused,
    remove: unused,
  } satisfies EmailManagedDnsService),
  Layer.succeed(EmailProviderRegistry, {
    get: unused,
  } satisfies EmailProviderRegistryService),
  Layer.succeed(Jobs, {
    cancel: unused,
    enqueue: unused,
    schedule: unused,
  } satisfies JobsService),
  Layer.succeed(ProviderCredentialsVault, {
    open: unused,
    seal: unused,
  } as never),
  Layer.succeed(SymmetricCrypto, {
    decrypt: unused,
    encrypt: unused,
  } as never)
);

describe("ensureSandboxForProvider", () => {
  test("no-ops when Cloudflare is not configured", () =>
    Effect.runPromise(
      ensureSandboxForProvider({
        cloudflareZoneId: null,
        provider,
        rootDomain: null,
      }).pipe(
        Effect.provide(unusedServices),
        Effect.map((result) => {
          expect(result).toEqual({
            allocated: 0,
            identityId: null,
            sandboxDomainId: null,
          });
          return result;
        })
      )
    ));

  test("sweeps unassigned Projects when the Provider already has an identity", () => {
    const db = {
      query: {
        sandboxDomain: {
          findFirst: () =>
            Effect.succeed({
              id: "snd_1",
              isActive: true,
              isPaused: false,
              rootDomain: "relayit.fyi",
              verificationStatus: "not_verified",
            }),
        },
        emailDomainProviderIdentity: {
          findFirst: () => Effect.succeed({ id: "epid_1" }),
        },
      },
    };

    return Effect.runPromise(
      ensureSandboxForProvider({
        cloudflareZoneId: "zone_1",
        provider,
        rootDomain: "relayit.fyi",
      }).pipe(
        Effect.provide(
          Layer.mergeAll(unusedServices, Layer.succeed(DB, db as never))
        ),
        Effect.map((result) => {
          expect(result).toEqual({
            allocated: 0,
            identityId: "epid_1",
            sandboxDomainId: "snd_1",
          });
          return result;
        })
      )
    );
  });
});

describe("removeSandboxProviderIdentity", () => {
  test("no-ops when the Provider has no sandbox identity", () => {
    const db = {
      query: {
        emailDomainProviderIdentity: {
          findFirst: () => Effect.succeed(null),
        },
      },
    };

    return Effect.runPromise(
      removeSandboxProviderIdentity(provider).pipe(
        Effect.provide(
          Layer.mergeAll(unusedServices, Layer.succeed(DB, db as never))
        )
      )
    );
  });

  test("keeps the sandbox root after removing the last identity", () => {
    const deleted: string[] = [];
    const cancelled: string[] = [];
    const sandboxUpdates: Array<{ isActive: boolean }> = [];

    const db = {
      query: {
        emailDomainProviderIdentity: {
          findFirst: () =>
            Effect.succeed({
              id: "epid_1",
              isActive: true,
              providerId: "prov_1",
              sandboxDomainId: "snd_1",
            }),
          findMany: () => Effect.succeed([]),
        },
        sandboxDomain: {
          findFirst: () => Effect.succeed(null),
        },
      },
      delete: () => ({
        where: () => {
          deleted.push("epid_1");
          return Effect.void;
        },
      }),
      update: () => ({
        set: (values: { isActive: boolean }) => ({
          where: () => {
            sandboxUpdates.push(values);
            return Effect.void;
          },
        }),
      }),
    };

    return Effect.runPromise(
      removeSandboxProviderIdentity(provider).pipe(
        Effect.provide(
          Layer.mergeAll(
            unusedServices,
            Layer.succeed(DB, db as never),
            Layer.succeed(EmailManagedDns, {
              cloudflareEnabled: true,
              reconcile: unused,
              remove: () => Effect.void,
            } satisfies EmailManagedDnsService),
            Layer.succeed(Jobs, {
              cancel: (_contract: unknown, payload: { identityId: string }) => {
                cancelled.push(payload.identityId);
                return Effect.void;
              },
              enqueue: unused,
              schedule: unused,
            } as never)
          )
        ),
        Effect.map(() => {
          expect(deleted).toEqual(["epid_1"]);
          expect(cancelled).toEqual(["epid_1"]);
          expect(sandboxUpdates).toEqual([{ isActive: false }]);
          return null;
        })
      )
    );
  });
});
