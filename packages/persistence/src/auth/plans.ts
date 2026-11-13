import { eq } from "drizzle-orm";
import type { PromiseDb } from "../db/promise";
import { AVAILABLE_CHANNELS, type UserLimits, user, userChannel } from "../db/schema";

export const FREE_LIMITS = {
  projects: 1,
  retention: 7,
  email: {
    customDomains: 1,
    transactional: {
      managed: { monthlySends: 2500, dailySends: 80 },
    },
    marketing: {
      managed: { monthlySends: 500, dailySends: 20 },
    },
  },
} satisfies UserLimits;

export const SIGNAL_LIMITS = {
  projects: 3,
  retention: 30,
  email: {
    customDomains: null,
    transactional: {
      managed: { monthlySends: 40_000, dailySends: null },
    },
    marketing: {
      managed: { monthlySends: 10_000, dailySends: null },
    },
  },
} satisfies UserLimits;

export const BROADCAST_LIMITS = {
  projects: 5,
  retention: 90,
  email: {
    customDomains: null,
    transactional: {
      managed: { monthlySends: 200_000, dailySends: null },
    },
    marketing: {
      managed: { monthlySends: 50_000, dailySends: null },
    },
  },
} satisfies UserLimits;

const UNLIMITED_SENDS = {
  dailySends: null,
  monthlySends: null,
} as const;

export const SELF_HOSTED_LIMITS = {
  projects: null,
  retention: null,
  email: {
    customDomains: null,
    transactional: {
      managed: UNLIMITED_SENDS,
    },
    marketing: {
      managed: UNLIMITED_SENDS,
    },
  },
} satisfies UserLimits;

export type PlanName = "free" | "signal" | "broadcast";

export type LimitsForInput =
  | { planName?: string | null; selfHosted?: false }
  | { selfHosted: true };

export const limitsFor = (input: LimitsForInput): UserLimits => {
  if ("selfHosted" in input && input.selfHosted) {
    return SELF_HOSTED_LIMITS;
  }

  switch (input.planName?.toLowerCase()) {
    case "signal":
      return SIGNAL_LIMITS;
    case "broadcast":
      return BROADCAST_LIMITS;
    default:
      return FREE_LIMITS;
  }
};

export const resolveUserPlanName = async (
  db: PromiseDb,
  userId: string,
  now: Date = new Date(),
): Promise<PlanName> => {
  const subscriptions = await db.query.subscription.findMany({
    where: { referenceId: userId },
  });

  const asDate = (value: Date | string) => (value instanceof Date ? value : new Date(value));

  const subscription = subscriptions.find((row) => {
    if (
      (row.status !== "active" && row.status !== "trialing") ||
      !row.periodStart ||
      !row.periodEnd
    ) {
      return false;
    }

    return asDate(row.periodEnd) > now;
  });

  const normalized = subscription?.plan.toLowerCase();
  if (normalized === "signal" || normalized === "broadcast") {
    return normalized;
  }

  return "free";
};

/**
 * Sync a billing user's plan limits onto the rows the send path actually reads:
 * `user.limitOrganizations` / `user.limitRetention`, and a `user_channel` row
 * per channel. Runs in one transaction; sequential (not Promise.all) because the
 * writes share a single tx connection.
 *
 * Cloud: `planName` is resolved (case-insensitive) to free / signal / broadcast;
 * unknown or absent falls back to free. Self-hosted: pass `{ selfHosted: true }`
 * for unlimited entitlements (no Plans).
 */
export async function ensureUserLimits(db: PromiseDb, input: LimitsForInput & { userId: string }) {
  const limits = limitsFor(input);

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({
        limitOrganizations: limits.projects,
        limitRetention: limits.retention,
      })
      .where(eq(user.id, input.userId));

    for (const channelType of AVAILABLE_CHANNELS) {
      const channelLimits = limits[channelType];

      await tx
        .insert(userChannel)
        .values({
          userId: input.userId,
          channelType,
          limits: channelLimits,
        })
        .onConflictDoUpdate({
          target: [userChannel.userId, userChannel.channelType],
          set: {
            limits: channelLimits,
          },
        });
    }
  });
}

export const syncSessionUserLimits = async (
  db: PromiseDb,
  { now, stripeConfigured, userId }: { now?: Date; stripeConfigured: boolean; userId: string },
) => {
  if (stripeConfigured) {
    const planName = await resolveUserPlanName(db, userId, now);
    await ensureUserLimits(db, { planName, userId });
    return;
  }

  await ensureUserLimits(db, { selfHosted: true, userId });
};
