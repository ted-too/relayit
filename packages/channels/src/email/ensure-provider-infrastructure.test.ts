import { describe, expect, test } from "bun:test";
import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import { DB } from "@repo/persistence/db/effect";
import type { Provider } from "@repo/persistence/db/schema";
import { Effect, Layer } from "effect";
import {
  emailProviderDeliveryWebhookUrl,
  ensureAllEmailProviderInfrastructure,
  ensureEmailProviderInfrastructure,
  teardownEmailProviderInfrastructure,
} from "./ensure-provider-infrastructure";
import { EmailManagedDns, type EmailManagedDnsService } from "./managed-dns";
import { EmailProviderRegistry } from "./provider-registry";

const unused = () => Effect.die("unused");

const awsProvider = {
  channelType: "email",
  credentials: { encrypted: {}, unencrypted: {} },
  id: "prov_aws",
  productId: "ses",
  vendorId: "aws",
} as Provider;

describe("emailProviderDeliveryWebhookUrl", () => {
  test("builds the provider webhook URL from the API origin", () => {
    expect(
      emailProviderDeliveryWebhookUrl("https://api.relayit.fyi/", "aws", "ses")
    ).toBe("https://api.relayit.fyi/webhooks/providers/aws/ses");
  });
});

describe("ensureEmailProviderInfrastructure", () => {
  test("asks the adapter to ensure vendor infrastructure and reconciles DNS", () => {
    const ensureUrls: string[] = [];
    const owners: string[] = [];

    const services = Layer.mergeAll(
      Layer.succeed(DB, {} as never),
      Layer.succeed(ProviderCredentialsVault, {
        open: () => Effect.succeed({ encrypted: {}, unencrypted: {} }),
        seal: unused,
      } as never),
      Layer.succeed(EmailManagedDns, {
        cloudflareEnabled: false,
        reconcile: (recordSet) =>
          Effect.sync(() => {
            owners.push(recordSet.owner);
          }),
        remove: unused,
      } satisfies EmailManagedDnsService),
      Layer.succeed(EmailProviderRegistry, {
        get: () =>
          Effect.succeed({
            create: () =>
              Effect.succeed({
                infrastructure: {
                  ensure: (input: { deliveryWebhookUrl: string }) =>
                    Effect.sync(() => {
                      ensureUrls.push(input.deliveryWebhookUrl);
                      return { managedDnsRecords: [] };
                    }),
                  teardown: unused,
                },
              }),
            definition: { typeId: "email:aws:ses" },
          }),
      } as never)
    );

    return Effect.runPromise(
      ensureEmailProviderInfrastructure(awsProvider, {
        deliveryWebhookUrl:
          "https://api.relayit.fyi/webhooks/providers/aws/ses",
      }).pipe(
        Effect.provide(services),
        Effect.map(() => {
          expect(ensureUrls).toEqual([
            "https://api.relayit.fyi/webhooks/providers/aws/ses",
          ]);
          expect(owners).toEqual(["provider:prov_aws:infrastructure"]);
          return ensureUrls;
        })
      )
    );
  });
});

describe("teardownEmailProviderInfrastructure", () => {
  test("asks the adapter to tear down vendor infrastructure and removes DNS", () => {
    const teardownUrls: string[] = [];
    const removed: string[] = [];

    const services = Layer.mergeAll(
      Layer.succeed(DB, {} as never),
      Layer.succeed(ProviderCredentialsVault, {
        open: () => Effect.succeed({ encrypted: {}, unencrypted: {} }),
        seal: unused,
      } as never),
      Layer.succeed(EmailManagedDns, {
        cloudflareEnabled: false,
        reconcile: unused,
        remove: (owner) =>
          Effect.sync(() => {
            removed.push(owner);
          }),
      } satisfies EmailManagedDnsService),
      Layer.succeed(EmailProviderRegistry, {
        get: () =>
          Effect.succeed({
            create: () =>
              Effect.succeed({
                infrastructure: {
                  ensure: unused,
                  teardown: (input: { deliveryWebhookUrl: string }) =>
                    Effect.sync(() => {
                      teardownUrls.push(input.deliveryWebhookUrl);
                    }),
                },
              }),
            definition: { typeId: "email:aws:ses" },
          }),
      } as never)
    );

    return Effect.runPromise(
      teardownEmailProviderInfrastructure(awsProvider, {
        deliveryWebhookUrl:
          "https://api.relayit.fyi/webhooks/providers/aws/ses",
      }).pipe(
        Effect.provide(services),
        Effect.map(() => {
          expect(teardownUrls).toEqual([
            "https://api.relayit.fyi/webhooks/providers/aws/ses",
          ]);
          expect(removed).toEqual(["provider:prov_aws:infrastructure"]);
          return teardownUrls;
        })
      )
    );
  });
});

describe("ensureAllEmailProviderInfrastructure", () => {
  test("ensures each email Provider against its own webhook URL", () => {
    const ensureUrls: string[] = [];
    const otherProvider = {
      ...awsProvider,
      id: "prov_other",
      productId: "other",
      vendorId: "acme",
    } as Provider;

    const services = Layer.mergeAll(
      Layer.succeed(DB, {
        query: {
          provider: {
            findMany: () => Effect.succeed([awsProvider, otherProvider]),
          },
        },
      } as never),
      Layer.succeed(ProviderCredentialsVault, {
        open: () => Effect.succeed({ encrypted: {}, unencrypted: {} }),
        seal: unused,
      } as never),
      Layer.succeed(EmailManagedDns, {
        cloudflareEnabled: false,
        reconcile: () => Effect.void,
        remove: unused,
      } satisfies EmailManagedDnsService),
      Layer.succeed(EmailProviderRegistry, {
        get: () =>
          Effect.succeed({
            create: () =>
              Effect.succeed({
                infrastructure: {
                  ensure: (input: { deliveryWebhookUrl: string }) =>
                    Effect.sync(() => {
                      ensureUrls.push(input.deliveryWebhookUrl);
                      return { managedDnsRecords: [] };
                    }),
                  teardown: unused,
                },
              }),
            definition: { typeId: "email:aws:ses" },
          }),
      } as never)
    );

    return Effect.runPromise(
      ensureAllEmailProviderInfrastructure("https://api.relayit.fyi").pipe(
        Effect.provide(services),
        Effect.map(() => {
          expect(ensureUrls).toEqual([
            "https://api.relayit.fyi/webhooks/providers/aws/ses",
            "https://api.relayit.fyi/webhooks/providers/acme/other",
          ]);
          return ensureUrls;
        })
      )
    );
  });
});
