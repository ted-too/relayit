import type { SecretConfig } from "better-auth/crypto";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";
import { Context, Data, Effect, Layer } from "effect";

declare const storedProviderCredentials: unique symbol;
declare const openedProviderCredentials: unique symbol;

export interface ProviderCredentials {
  readonly encrypted: Record<string, unknown>;
  readonly unencrypted: Record<string, unknown>;
}

export type StoredProviderCredentials = ProviderCredentials & {
  readonly [storedProviderCredentials]: true;
};

export type OpenedProviderCredentials = ProviderCredentials & {
  readonly [openedProviderCredentials]: true;
};

export class CredentialsEncryptionError extends Data.TaggedError(
  "CredentialsEncryptionError"
)<{
  readonly cause: unknown;
}> {}

export class CredentialsDecryptionError extends Data.TaggedError(
  "CredentialsDecryptionError"
)<{
  readonly cause: unknown;
}> {}

const transformRecord = <E>(
  record: Record<string, unknown>,
  transform: (value: string) => Effect.Effect<string, E>
): Effect.Effect<Record<string, unknown>, E> =>
  Effect.gen(function* () {
    const transformed: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
      if (typeof value === "string") {
        transformed[key] = yield* transform(value);
      } else if (Array.isArray(value)) {
        transformed[key] = yield* Effect.forEach(value, (item) =>
          typeof item === "string"
            ? transform(item)
            : typeof item === "object" && item !== null
              ? transformRecord(item as Record<string, unknown>, transform)
              : Effect.succeed(item)
        );
      } else if (typeof value === "object" && value !== null) {
        transformed[key] = yield* transformRecord(
          value as Record<string, unknown>,
          transform
        );
      } else {
        transformed[key] = value;
      }
    }

    return transformed;
  });

export class ProviderCredentialsVault extends Context.Service<
  ProviderCredentialsVault,
  {
    readonly open: (
      credentials: StoredProviderCredentials
    ) => Effect.Effect<OpenedProviderCredentials, CredentialsDecryptionError>;
    readonly seal: (
      credentials: ProviderCredentials
    ) => Effect.Effect<StoredProviderCredentials, CredentialsEncryptionError>;
  }
>()("Persistence/ProviderCredentialsVault") {
  static live(key: SecretConfig) {
    const decrypt = (value: string) =>
      Effect.tryPromise({
        catch: (cause) => new CredentialsDecryptionError({ cause }),
        try: () => symmetricDecrypt({ data: value, key }),
      });

    const encrypt = (value: string) =>
      Effect.tryPromise({
        catch: (cause) => new CredentialsEncryptionError({ cause }),
        try: () => symmetricEncrypt({ data: value, key }),
      });

    return Layer.succeed(ProviderCredentialsVault, {
      open: (credentials) =>
        transformRecord(credentials.encrypted, decrypt).pipe(
          Effect.map(
            (encrypted) =>
              ({
                encrypted,
                unencrypted: credentials.unencrypted,
              }) as OpenedProviderCredentials
          )
        ),
      seal: (credentials) =>
        transformRecord(credentials.encrypted, encrypt).pipe(
          Effect.map(
            (encrypted) =>
              ({
                encrypted,
                unencrypted: credentials.unencrypted,
              }) as StoredProviderCredentials
          )
        ),
    });
  }
}
