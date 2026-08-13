import { Context, Effect, Layer } from "effect";
import { DuplicateProvider, ProviderNotFound } from "../provider-errors";
import type { ProviderTypeId } from "../provider-type";
import type { EmailProviderFactory } from "./provider-adapter";

export interface EmailProviderRegistryService {
  readonly get: (
    typeId: ProviderTypeId
  ) => Effect.Effect<EmailProviderFactory, ProviderNotFound>;
}

const buildProviderRegistry = (factories: readonly EmailProviderFactory[]) =>
  Effect.gen(function* () {
    const factoriesByType = new Map<ProviderTypeId, EmailProviderFactory>();

    for (const factory of factories) {
      const { typeId } = factory.definition;

      if (factoriesByType.has(typeId)) {
        return yield* new DuplicateProvider({ typeId });
      }

      factoriesByType.set(typeId, factory);
    }

    return {
      get: (typeId) => {
        const factory = factoriesByType.get(typeId);

        return factory
          ? Effect.succeed(factory)
          : Effect.fail(new ProviderNotFound({ typeId }));
      },
    } satisfies EmailProviderRegistryService;
  });

export class EmailProviderRegistry extends Context.Service<
  EmailProviderRegistry,
  EmailProviderRegistryService
>()("Channels/EmailProviderRegistry") {
  static live(...factories: readonly EmailProviderFactory[]) {
    return Layer.effect(
      EmailProviderRegistry,
      buildProviderRegistry(factories)
    );
  }
}
