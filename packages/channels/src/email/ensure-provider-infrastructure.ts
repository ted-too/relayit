import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import { DB } from "@repo/persistence/db/effect";
import type { Provider } from "@repo/persistence/db/schema";
import { Effect } from "effect";
import { makeProviderTypeId } from "../provider-type";
import { EmailManagedDns } from "./managed-dns";
import { EmailProviderRegistry } from "./provider-registry";

export interface EmailProviderInfrastructureConfig {
  readonly deliveryWebhookUrl: string;
}

export const ensureEmailProviderInfrastructure = (
  provider: Provider,
  config: EmailProviderInfrastructureConfig
) =>
  Effect.gen(function* () {
    const credentialsVault = yield* ProviderCredentialsVault;
    const providers = yield* EmailProviderRegistry;
    const managedDns = yield* EmailManagedDns;
    const factory = yield* providers.get(
      makeProviderTypeId(provider.vendorId, provider.productId)
    );
    const credentials = yield* credentialsVault.open(provider.credentials);
    const adapter = yield* factory.create({
      credentials,
      providerId: provider.id,
    });

    if (!adapter.infrastructure) {
      return;
    }

    const plan = yield* adapter.infrastructure.ensure({
      deliveryWebhookUrl: config.deliveryWebhookUrl,
    });

    yield* managedDns.reconcile({
      owner: `provider:${provider.id}:infrastructure`,
      records: plan.managedDnsRecords,
    });
  });

export const ensureAllEmailProviderInfrastructure = (
  config: EmailProviderInfrastructureConfig
) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const configuredProviders = yield* db.query.provider.findMany({
      where: { channelType: "email" },
    });

    yield* Effect.forEach(
      configuredProviders,
      (provider) => ensureEmailProviderInfrastructure(provider, config),
      { concurrency: "unbounded" }
    );
  });

export const teardownEmailProviderInfrastructure = (
  provider: Provider,
  config: EmailProviderInfrastructureConfig
) =>
  Effect.gen(function* () {
    const credentialsVault = yield* ProviderCredentialsVault;
    const providers = yield* EmailProviderRegistry;
    const managedDns = yield* EmailManagedDns;
    const factory = yield* providers.get(
      makeProviderTypeId(provider.vendorId, provider.productId)
    );
    const credentials = yield* credentialsVault.open(provider.credentials);
    const adapter = yield* factory.create({
      credentials,
      providerId: provider.id,
    });

    if (adapter.infrastructure) {
      yield* adapter.infrastructure.teardown({
        deliveryWebhookUrl: config.deliveryWebhookUrl,
      });
    }

    yield* managedDns.remove(`provider:${provider.id}:infrastructure`);
  });
