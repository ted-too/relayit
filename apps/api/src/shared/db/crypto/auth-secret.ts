import type { SecretConfig } from "better-auth/crypto";

export interface VersionedSecret {
  value: string;
  version: number;
}

/**
 * Parse Better Auth's `BETTER_AUTH_SECRETS` format: `1:current,0:previous`.
 * First entry is the current encryption version (same as Better Auth).
 * @see https://better-auth.com/docs/reference/security
 */
export function parseBetterAuthSecretsEnv(envValue: string): VersionedSecret[] {
  return envValue.split(",").map((entry) => {
    const trimmed = entry.trim();
    const colonIdx = trimmed.indexOf(":");
    if (colonIdx === -1) {
      throw new Error(
        `Invalid BETTER_AUTH_SECRETS entry: "${trimmed}". Expected "<version>:<secret>".`
      );
    }

    const version = Number.parseInt(trimmed.slice(0, colonIdx), 10);
    if (!Number.isInteger(version) || version < 0) {
      throw new Error(
        `Invalid version in BETTER_AUTH_SECRETS: "${trimmed.slice(0, colonIdx)}".`
      );
    }

    const value = trimmed.slice(colonIdx + 1).trim();
    if (!value) {
      throw new Error(
        `Empty secret value for version ${version} in BETTER_AUTH_SECRETS.`
      );
    }

    return { value, version };
  });
}

/**
 * Build a Better Auth `SecretConfig` from versioned secrets only
 * (`BETTER_AUTH_SECRETS`). No single-secret fallback.
 */
export function buildAuthSecretConfig(secretsEnv: string): SecretConfig {
  const versioned = parseBetterAuthSecretsEnv(secretsEnv);
  const [current] = versioned;
  if (!current) {
    throw new Error("`BETTER_AUTH_SECRETS` must contain at least one entry.");
  }

  const keys = new Map<number, string>();
  for (const secret of versioned) {
    if (keys.has(secret.version)) {
      throw new Error(
        `Duplicate version ${secret.version} in BETTER_AUTH_SECRETS.`
      );
    }
    keys.set(secret.version, secret.value);
  }

  return {
    currentVersion: current.version,
    keys,
  };
}

/** Current (first) secret value — for HMAC and similar non-envelope uses. */
export function getCurrentAuthSecret(secretsEnv: string): string {
  const [current] = parseBetterAuthSecretsEnv(secretsEnv);
  if (!current) {
    throw new Error("`BETTER_AUTH_SECRETS` must contain at least one entry.");
  }
  return current.value;
}
