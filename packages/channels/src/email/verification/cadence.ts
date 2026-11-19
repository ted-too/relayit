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
  const intervalMs = Math.min(config.pendingBaseMs * 2 ** level, config.pendingMaxMs);

  return {
    backoffLevel:
      verificationStatus === "not_verified" ? Math.min(level + 1, config.maxBackoffLevel) : level,
    nextCheckAt: new Date(from.getTime() + intervalMs),
  };
};

/**
 * How often a custom Domain that is not verified is checked. Each check asks SES once, and
 * SES allows one such call a second for the whole account, so a Domain nobody is verifying
 * must stop costing it: the wait doubles from `firstIntervalMs` after each check that finds
 * it unverified, up to `maxIntervalMs`, and once the next check would fall more than
 * `stopAfterMs` after the first there is none. That is 22 checks over a week: ten in the
 * first 17 hours, when records are usually published, then one every 12 hours, which is
 * what a verified Domain costs. Seven days is also how long a claim has to be proven.
 */
export const UNVERIFIED_DOMAIN_CHECKS = {
  firstIntervalMs: 2 * 60 * 1000,
  maxIntervalMs: 12 * 60 * 60 * 1000,
  stopAfterMs: 7 * 24 * 60 * 60 * 1000,
} as const;

/**
 * A custom Domain's next check, from how many checks in a row have found it unverified
 * (`unverifiedChecks`, kept in `verify_backoff_level`). `nextCheckAt` is null when its
 * checks stop: from then it is checked only when its holder refreshes it or another
 * Project's claim on it is proven, either of which starts the count again. Partially
 * verified counts as unverified: a Domain can stay that way for good.
 */
export const computeNextDomainCheckAt = ({
  verificationStatus,
  unverifiedChecks,
  from,
}: {
  from: Date;
  unverifiedChecks: number;
  verificationStatus: DomainVerificationStatus;
}): { nextCheckAt: Date | null; unverifiedChecks: number } => {
  if (verificationStatus === "verified") {
    return {
      nextCheckAt: new Date(from.getTime() + defaultVerifyCadenceConfig.verifiedIntervalMs),
      unverifiedChecks: 0,
    };
  }

  const { firstIntervalMs, maxIntervalMs, stopAfterMs } = UNVERIFIED_DOMAIN_CHECKS;
  const intervalAfter = (checks: number) => Math.min(firstIntervalMs * 2 ** checks, maxIntervalMs);
  let waitedMs = 0;
  for (let earlier = 0; earlier < unverifiedChecks; earlier += 1) {
    waitedMs += intervalAfter(earlier);
  }
  const intervalMs = intervalAfter(unverifiedChecks);
  if (waitedMs + intervalMs > stopAfterMs) {
    return { nextCheckAt: null, unverifiedChecks };
  }
  return {
    nextCheckAt: new Date(from.getTime() + intervalMs),
    unverifiedChecks: unverifiedChecks + 1,
  };
};

/**
 * Whether a custom Domain's checks have stopped: one has run, and none is due. A Domain no
 * check has run for has no next check either, and is due now.
 */
export const domainChecksStopped = (domain: {
  readonly lastCheckedAt: Date | null;
  readonly nextVerifyAt: Date | null;
}) => domain.lastCheckedAt !== null && domain.nextVerifyAt === null;

export const mergeVerificationStatus = ({
  sesVerified,
  sesDkimVerified,
  activeRecords,
  missingRecords,
}: {
  activeRecords: number;
  missingRecords: number;
  sesDkimVerified: boolean;
  sesVerified: boolean;
}): DomainVerificationStatus => {
  let status: DomainVerificationStatus = "not_verified";

  if (sesVerified && sesDkimVerified) {
    status = "verified";
  } else if (sesVerified || sesDkimVerified) {
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
