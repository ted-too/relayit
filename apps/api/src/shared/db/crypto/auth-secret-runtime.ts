import type { SecretConfig } from "better-auth/crypto";
import { env } from "@repo/api/env";
import {
  buildAuthSecretConfig,
  getCurrentAuthSecret,
} from "./auth-secret";

export function getAuthSecretConfig(): SecretConfig {
  return buildAuthSecretConfig(env.BETTER_AUTH_SECRETS);
}

export function getCurrentAuthSecretValue(): string {
  return getCurrentAuthSecret(env.BETTER_AUTH_SECRETS);
}
