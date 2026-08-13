import type { DomainVerificationStatus } from "@repo/persistence/db/schema";

export interface VerifyCadenceConfig {
  readonly maxBackoffLevel: number;
  readonly pendingBaseMs: number;
  readonly pendingMaxMs: number;
  readonly verifiedIntervalMs: number;
}

export const defaultVerifyCadenceConfig: VerifyCadenceConfig = {
  maxBackoffLevel: 5,
  pendingBaseMs: 2 * 60 * 1000,
  pendingMaxMs: 15 * 60 * 1000,
  verifiedIntervalMs: 12 * 60 * 60 * 1000,
};

export const computeNextCheckAt = ({
  verificationStatus,
  backoffLevel,
  config = defaultVerifyCadenceConfig,
  from = new Date(),
}: {
  backoffLevel: number;
  config?: VerifyCadenceConfig;
  from?: Date;
  verificationStatus: DomainVerificationStatus;
}): { backoffLevel: number; nextCheckAt: Date } => {
  if (verificationStatus === "verified") {
    return {
      backoffLevel: 0,
      nextCheckAt: new Date(from.getTime() + config.verifiedIntervalMs),
    };
  }

  const level = Math.min(backoffLevel, config.maxBackoffLevel);
  const intervalMs = Math.min(
    config.pendingBaseMs * 2 ** level,
    config.pendingMaxMs
  );

  return {
    backoffLevel:
      verificationStatus === "not_verified"
        ? Math.min(level + 1, config.maxBackoffLevel)
        : level,
    nextCheckAt: new Date(from.getTime() + intervalMs),
  };
};

export const mergeVerificationStatus = ({
  providerVerified,
  providerDkimVerified,
  activeRecords,
  missingRecords,
}: {
  activeRecords: number;
  missingRecords: number;
  providerDkimVerified: boolean;
  providerVerified: boolean;
}): DomainVerificationStatus => {
  let status: DomainVerificationStatus = "not_verified";

  if (providerVerified && providerDkimVerified) {
    status = "verified";
  } else if (providerVerified || providerDkimVerified) {
    status = "partially_verified";
  }

  if (activeRecords === 0) {
    status = "not_verified";
  } else if (missingRecords > 0) {
    status = "partially_verified";
  } else if (activeRecords > 0 && missingRecords === 0) {
    status = "verified";
  }

  return status;
};

/**
 * Domain-level verify jobs must run at the sooner of Provider cadence and
 * DNS cadence. A verified Provider (12h) must not starve incomplete DNS (2m).
 */
export const nextDomainVerifyAt = (input: {
  readonly identityNextCheckAt: Date;
  readonly nextCheckAt: Date | null;
}): Date => {
  if (
    input.nextCheckAt !== null &&
    input.nextCheckAt < input.identityNextCheckAt
  ) {
    return input.nextCheckAt;
  }
  return input.identityNextCheckAt;
};
