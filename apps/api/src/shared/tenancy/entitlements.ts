import type { EmailLimits, UserLimits } from "@repo/api/db";
import { IS_CLOUD_EDITION } from "@repo/api/env";

const UNLIMITED_BUCKET = { monthlySends: null, dailySends: null } as const;

/** Self-hosted: no Plan packaging — behave as unlimited entitlements. */
export const SELF_HOSTED_UNLIMITED_EMAIL_LIMITS = {
  byoProviders: true,
  customDomains: null,
  transactional: {
    managed: UNLIMITED_BUCKET,
    byo: UNLIMITED_BUCKET,
  },
  marketing: {
    managed: UNLIMITED_BUCKET,
    byo: UNLIMITED_BUCKET,
  },
} satisfies EmailLimits;

export const SELF_HOSTED_UNLIMITED_USER_LIMITS = {
  projects: null,
  retention: null,
  email: SELF_HOSTED_UNLIMITED_EMAIL_LIMITS,
} satisfies UserLimits;

export function emailLimitsForEdition(cloudLimits: EmailLimits): EmailLimits {
  if (!IS_CLOUD_EDITION) {
    return SELF_HOSTED_UNLIMITED_EMAIL_LIMITS;
  }
  return cloudLimits;
}

export function isByoProvidersAllowed(emailLimits: EmailLimits): boolean {
  return emailLimitsForEdition(emailLimits).byoProviders;
}
