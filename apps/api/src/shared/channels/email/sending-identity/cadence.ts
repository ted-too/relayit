import type { DomainVerificationStatus } from "@repo/api/db";

export interface VerifyCadenceConfig {
  maxBackoffLevel: number;
  pendingBaseMs: number;
  pendingMaxMs: number;
  verifiedIntervalMs: number;
}

export const defaultVerifyCadenceConfig: VerifyCadenceConfig = {
  pendingBaseMs: 2 * 60 * 1000,
  pendingMaxMs: 15 * 60 * 1000,
  verifiedIntervalMs: 12 * 60 * 60 * 1000,
  maxBackoffLevel: 5,
};

export function computeNextCheckAt({
  verificationStatus,
  backoffLevel,
  config = defaultVerifyCadenceConfig,
  from = new Date(),
}: {
  verificationStatus: DomainVerificationStatus;
  backoffLevel: number;
  config?: VerifyCadenceConfig;
  from?: Date;
}): { nextCheckAt: Date; backoffLevel: number } {
  if (verificationStatus === "verified") {
    return {
      nextCheckAt: new Date(from.getTime() + config.verifiedIntervalMs),
      backoffLevel: 0,
    };
  }

  const level = Math.min(backoffLevel, config.maxBackoffLevel);
  const multiplier = 2 ** level;
  const intervalMs = Math.min(
    config.pendingBaseMs * multiplier,
    config.pendingMaxMs
  );

  return {
    nextCheckAt: new Date(from.getTime() + intervalMs),
    backoffLevel:
      verificationStatus === "not_verified"
        ? Math.min(level + 1, config.maxBackoffLevel)
        : level,
  };
}

export function mergeVerificationStatus({
  providerVerified,
  providerDkimVerified,
  activeRecords,
  missingRecords,
}: {
  providerVerified: boolean;
  providerDkimVerified: boolean;
  activeRecords: number;
  missingRecords: number;
}): DomainVerificationStatus {
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
}
