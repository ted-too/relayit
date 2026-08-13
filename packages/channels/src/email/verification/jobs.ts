import { defineJob, type JobPayload } from "@repo/jobs";
import { Schema } from "effect";

const verifyRetry = {
  backoff: {
    baseDelayMs: 30_000,
    maxDelayMs: 15 * 60_000,
  },
  maxAttempts: 5,
} as const;

export const emailVerifyProviderIdentityJob = defineJob({
  name: "email.verify-provider-identity",
  payload: Schema.Struct({
    identityId: Schema.String,
  }),
  recurrence: {
    identity: ({ identityId }) => identityId,
  },
  retry: verifyRetry,
});

export const emailVerifySandboxDomainJob = defineJob({
  name: "email.verify-sandbox-domain",
  payload: Schema.Struct({
    sandboxDomainId: Schema.String,
  }),
  recurrence: {
    identity: ({ sandboxDomainId }) => sandboxDomainId,
  },
  retry: verifyRetry,
});

export const emailVerifyCustomDomainJob = defineJob({
  name: "email.verify-custom-domain",
  payload: Schema.Struct({
    customDomainId: Schema.String,
  }),
  recurrence: {
    identity: ({ customDomainId }) => customDomainId,
  },
  retry: verifyRetry,
});

export const emailVerifyOwnershipJob = defineJob({
  name: "email.verify-ownership",
  payload: Schema.Struct({
    customDomainId: Schema.String,
    organizationId: Schema.String,
  }),
  recurrence: {
    identity: ({ customDomainId, organizationId }) =>
      `${organizationId}:${customDomainId}`,
  },
  retry: verifyRetry,
});

export type EmailVerifyProviderIdentityPayload = JobPayload<
  typeof emailVerifyProviderIdentityJob
>;
export type EmailVerifySandboxDomainPayload = JobPayload<
  typeof emailVerifySandboxDomainJob
>;
export type EmailVerifyCustomDomainPayload = JobPayload<
  typeof emailVerifyCustomDomainJob
>;
export type EmailVerifyOwnershipPayload = JobPayload<
  typeof emailVerifyOwnershipJob
>;
