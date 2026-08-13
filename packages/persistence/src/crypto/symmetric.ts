import type { SecretConfig } from "better-auth/crypto";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { Context, Data, Effect, Layer } from "effect";

export class SymmetricCryptoError extends Data.TaggedError(
  "SymmetricCryptoError"
)<{
  readonly cause: unknown;
  readonly operation: "decrypt" | "encrypt";
}> {}

export class SymmetricCrypto extends Context.Service<
  SymmetricCrypto,
  {
    readonly decrypt: (
      value: string
    ) => Effect.Effect<string, SymmetricCryptoError>;
    readonly encrypt: (
      value: string
    ) => Effect.Effect<string, SymmetricCryptoError>;
  }
>()("Persistence/SymmetricCrypto") {
  static live(key: SecretConfig) {
    return Layer.succeed(SymmetricCrypto, {
      decrypt: (value) =>
        Effect.tryPromise({
          catch: (cause) =>
            new SymmetricCryptoError({ cause, operation: "decrypt" }),
          try: () => symmetricDecrypt({ data: value, key }),
        }),
      encrypt: (value) =>
        Effect.tryPromise({
          catch: (cause) =>
            new SymmetricCryptoError({ cause, operation: "encrypt" }),
          try: () => symmetricEncrypt({ data: value, key }),
        }),
    });
  }
}
