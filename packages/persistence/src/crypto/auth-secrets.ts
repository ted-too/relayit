import type { SecretConfig } from "better-auth/crypto";

/**
 * Parse `BETTER_AUTH_SECRETS` (`2:current,1:previous`) into better-auth's
 * {@link SecretConfig} for credential vault open/seal.
 */
export const parseBetterAuthSecrets = (value: string): SecretConfig => {
  const entries = value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const separator = part.indexOf(":");
      if (separator <= 0) {
        throw new Error(
          'BETTER_AUTH_SECRETS must be "<version>:<secret>[,<version>:<secret>…]"'
        );
      }
      const version = Number.parseInt(part.slice(0, separator), 10);
      const secret = part.slice(separator + 1);
      if (!Number.isFinite(version) || secret.length === 0) {
        throw new Error(
          'BETTER_AUTH_SECRETS must be "<version>:<secret>[,<version>:<secret>…]"'
        );
      }
      return { secret, version };
    });

  if (entries.length === 0) {
    throw new Error("BETTER_AUTH_SECRETS must include at least one secret");
  }

  const keys = new Map<number, string>();
  for (const entry of entries) {
    keys.set(entry.version, entry.secret);
  }

  return {
    currentVersion: entries[0]?.version ?? 1,
    keys,
  } as SecretConfig;
};

/** Current (first) secret value — used for HMAC signing (e.g. List-Unsubscribe). */
export const getCurrentBetterAuthSecret = (value: string): string => {
  const config = parseBetterAuthSecrets(value);
  const secret = config.keys.get(config.currentVersion);
  if (!secret) {
    throw new Error("BETTER_AUTH_SECRETS current version has no secret");
  }
  return secret;
};
