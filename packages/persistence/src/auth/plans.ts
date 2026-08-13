// import type { StripePlan } from "@better-auth/stripe";
// import type { RedisClient } from "bun";
import { eq } from "drizzle-orm";
import type { PromiseDb } from "../db/promise";
import {
  AVAILABLE_CHANNELS,
  // type BucketSendLimits,
  // type ChannelType,
  // type EmailLimits,
  // type MessagePurpose,
  // type ProviderKind,
  type UserLimits,
  // AVAILABLE_MESSAGE_PURPOSES,
  // AVAILABLE_PROVIDER_KINDS,
  user,
  userChannel,
} from "../db/schema";

export const FREE_LIMITS = {
  projects: 1,
  retention: 7,
  email: {
    byoProviders: false,
    customDomains: 1,
    transactional: {
      managed: { monthlySends: 2500, dailySends: 80 },
      byo: { monthlySends: 10_000, dailySends: 500 },
    },
    marketing: {
      managed: { monthlySends: 500, dailySends: 20 },
      byo: { monthlySends: 2000, dailySends: 100 },
    },
  },
} satisfies UserLimits;

export const SIGNAL_LIMITS = {
  projects: 3,
  retention: 30,
  email: {
    byoProviders: false,
    customDomains: null,
    transactional: {
      managed: { monthlySends: 40_000, dailySends: null },
      byo: { monthlySends: 200_000, dailySends: null },
    },
    marketing: {
      managed: { monthlySends: 10_000, dailySends: null },
      byo: { monthlySends: 50_000, dailySends: null },
    },
  },
} satisfies UserLimits;

export const BROADCAST_LIMITS = {
  projects: 5,
  retention: 90,
  email: {
    byoProviders: true,
    customDomains: null,
    transactional: {
      managed: { monthlySends: 200_000, dailySends: null },
      byo: { monthlySends: 1_000_000, dailySends: null },
    },
    marketing: {
      managed: { monthlySends: 50_000, dailySends: null },
      byo: { monthlySends: 250_000, dailySends: null },
    },
  },
} satisfies UserLimits;

export type PlanName = "free" | "signal" | "broadcast";

/**
 * Sync a billing user's plan limits onto the rows the send path actually reads:
 * `user.limitOrganizations` / `user.limitRetention`, and a `user_channel` row
 * per channel. Runs in one transaction; sequential (not Promise.all) because the
 * writes share a single tx connection.
 */
export async function ensureUserLimits(
  db: PromiseDb,
  {
    userId,
    planName,
  }: {
    userId: string;
    planName?: string | null;
  }
) {
  let limits: UserLimits = FREE_LIMITS;
  switch (planName) {
    case "signal":
      limits = SIGNAL_LIMITS;
      break;
    case "broadcast":
      limits = BROADCAST_LIMITS;
      break;
    default:
      limits = FREE_LIMITS;
      break;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(user)
      .set({
        limitOrganizations: limits.projects,
        limitRetention: limits.retention,
      })
      .where(eq(user.id, userId));

    for (const channelType of AVAILABLE_CHANNELS) {
      const channelLimits = limits[channelType];

      await tx
        .insert(userChannel)
        .values({
          userId,
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

// function asPlanName(name: string | undefined | null): PlanName {
//   const normalized = name?.toLowerCase();
//   if (
//     normalized === "free" ||
//     normalized === "signal" ||
//     normalized === "broadcast"
//   ) {
//     return normalized;
//   }
//   return "free";
// }

// export interface BillingPeriod {
//   end: Date;
//   start: Date;
// }

// function daysInUtcMonth(year: number, monthIndex: number) {
//   return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
// }

// function anniversaryDateUtc(
//   year: number,
//   monthIndex: number,
//   anchor: Date
// ): Date {
//   const day = Math.min(anchor.getUTCDate(), daysInUtcMonth(year, monthIndex));
//   return new Date(
//     Date.UTC(
//       year,
//       monthIndex,
//       day,
//       anchor.getUTCHours(),
//       anchor.getUTCMinutes(),
//       anchor.getUTCSeconds(),
//       anchor.getUTCMilliseconds()
//     )
//   );
// }

// /**
//  * Rolling Billing Period anchored to account creation (free Users).
//  * Window starts on each anniversary of `anchor` and ends at the next.
//  */
// export function anniversaryBillingPeriod(
//   anchor: Date,
//   now: Date = new Date()
// ): BillingPeriod {
//   let start = anniversaryDateUtc(
//     now.getUTCFullYear(),
//     now.getUTCMonth(),
//     anchor
//   );

//   if (now < start) {
//     const prevMonth = now.getUTCMonth() === 0 ? 11 : now.getUTCMonth() - 1;
//     const prevYear =
//       now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
//     start = anniversaryDateUtc(prevYear, prevMonth, anchor);
//   }

//   const nextMonth = start.getUTCMonth() === 11 ? 0 : start.getUTCMonth() + 1;
//   const nextYear =
//     start.getUTCMonth() === 11
//       ? start.getUTCFullYear() + 1
//       : start.getUTCFullYear();
//   const end = anniversaryDateUtc(nextYear, nextMonth, anchor);

//   return { start, end };
// }

// /**
//  * Resolve the current Billing Period for a Billing User:
//  * active/trialing Stripe subscription → its period; otherwise anniversary of
//  * `user.createdAt`.
//  */
// export async function resolveBillingPeriod(
//   userId: string,
//   now: Date = new Date()
// ): Promise<BillingPeriod & { planName: PlanName }> {
//   const [subscriptions, user] = await Promise.all([
//     db.query.subscription.findMany({
//       where: (table, { eq: equals }) => equals(table.referenceId, userId),
//       orderBy: (table, { desc }) => [desc(table.periodStart)],
//     }),
//     db.query.user.findFirst({
//       where: (table, { eq: equals }) => equals(table.id, userId),
//       columns: { createdAt: true },
//     }),
//   ]);

//   const subscription = subscriptions.find(
//     (row) =>
//       (row.status === "active" || row.status === "trialing") &&
//       row.periodStart &&
//       row.periodEnd &&
//       row.periodEnd > now
//   );

//   if (subscription?.periodStart && subscription.periodEnd) {
//     return {
//       start: subscription.periodStart,
//       end: subscription.periodEnd,
//       planName: asPlanName(
//         plans.find((p) => p.name === subscription.plan?.toLowerCase())?.name
//       ),
//     };
//   }

//   if (!user) {
//     const fallback = anniversaryBillingPeriod(now, now);
//     return { ...fallback, planName: "free" };
//   }

//   return {
//     ...anniversaryBillingPeriod(user.createdAt, now),
//     planName: "free",
//   };
// }

// function periodKey(periodStart: Date) {
//   return periodStart.toISOString().slice(0, 10);
// }

// function monthlyQuotaKey({
//   userId,
//   channel,
//   purpose,
//   providerKind,
//   periodStart,
// }: {
//   userId: string;
//   channel: ChannelType;
//   purpose: MessagePurpose;
//   providerKind: ProviderKind;
//   periodStart: Date;
// }) {
//   return `relayit:user:${userId}:quota:${channel}:${purpose}:${providerKind}:period:${periodKey(periodStart)}`;
// }

// function dailyQuotaKey({
//   userId,
//   channel,
//   purpose,
//   providerKind,
//   date,
// }: {
//   userId: string;
//   channel: ChannelType;
//   purpose: MessagePurpose;
//   providerKind: ProviderKind;
//   date: Date;
// }) {
//   const year = date.getUTCFullYear();
//   const month = String(date.getUTCMonth() + 1).padStart(2, "0");
//   const day = String(date.getUTCDate()).padStart(2, "0");
//   return `relayit:user:${userId}:quota:${channel}:${purpose}:${providerKind}:day:${year}-${month}-${day}`;
// }

// function secondsUntil(date: Date, now: Date = new Date()) {
//   return Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 1000));
// }

// function secondsUntilUtcDayEnd(date: Date) {
//   const nextDay = new Date(
//     Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)
//   );
//   return secondsUntil(nextDay, date);
// }

// export function getBucketLimits(
//   channelLimits: EmailLimits,
//   purpose: MessagePurpose,
//   providerKind: ProviderKind
// ): BucketSendLimits {
//   return channelLimits[purpose][providerKind];
// }

// /** DECR but never below zero — safe for rollbacks and quota-rejection paths. */
// async function decrQuotaKey(redis: RedisClient, key: string) {
//   await redis.send("EVAL", [
//     `local count = redis.call("GET", KEYS[1])
// if count and tonumber(count) > 0 then
//   return redis.call("DECR", KEYS[1])
// end
// return 0`,
//     "1",
//     key,
//   ]);
// }

// export async function rollbackChannelSendQuota({
//   channel,
//   purpose,
//   providerKind,
//   limits,
//   userId,
//   date,
//   period,
//   redis,
// }: {
//   channel: ChannelType;
//   purpose: MessagePurpose;
//   providerKind: ProviderKind;
//   limits: EmailLimits;
//   userId: string;
//   date: Date;
//   period: BillingPeriod;
//   redis: RedisClient;
// }) {
//   const bucket = getBucketLimits(
//     emailLimitsForEdition(limits),
//     purpose,
//     providerKind
//   );

//   if (bucket.dailySends !== null) {
//     await decrQuotaKey(
//       redis,
//       dailyQuotaKey({ userId, channel, purpose, providerKind, date })
//     );
//   }

//   if (bucket.monthlySends !== null) {
//     await decrQuotaKey(
//       redis,
//       monthlyQuotaKey({
//         userId,
//         channel,
//         purpose,
//         providerKind,
//         periodStart: period.start,
//       })
//     );
//   }
// }

// export async function consumeChannelSendQuota({
//   channel,
//   purpose,
//   providerKind,
//   limits,
//   userId,
//   date,
//   period,
//   redis,
// }: {
//   channel: ChannelType;
//   purpose: MessagePurpose;
//   providerKind: ProviderKind;
//   limits: EmailLimits;
//   userId: string;
//   date: Date;
//   period: BillingPeriod;
//   redis: RedisClient;
// }) {
//   // OSS/self-host: null buckets → no Redis metering (unlimited).
//   const bucket = getBucketLimits(
//     emailLimitsForEdition(limits),
//     purpose,
//     providerKind
//   );

//   if (bucket.dailySends !== null) {
//     const key = dailyQuotaKey({
//       userId,
//       channel,
//       purpose,
//       providerKind,
//       date,
//     });
//     const count = Number(await redis.send("INCR", [key]));

//     if (count === 1) {
//       await redis.send("EXPIRE", [key, String(secondsUntilUtcDayEnd(date))]);
//     }

//     if (count > bucket.dailySends) {
//       await decrQuotaKey(redis, key);

//       return {
//         status: 429,
//         code: "daily_quota_exceeded",
//         message: "Daily send quota exceeded",
//         retryAfterSeconds: secondsUntilUtcDayEnd(date),
//       } as const;
//     }
//   }

//   if (bucket.monthlySends !== null) {
//     const key = monthlyQuotaKey({
//       userId,
//       channel,
//       purpose,
//       providerKind,
//       periodStart: period.start,
//     });
//     const count = Number(await redis.send("INCR", [key]));

//     if (count === 1) {
//       await redis.send("EXPIRE", [key, String(secondsUntil(period.end, date))]);
//     }

//     if (count > bucket.monthlySends) {
//       await decrQuotaKey(redis, key);

//       if (bucket.dailySends !== null) {
//         await decrQuotaKey(
//           redis,
//           dailyQuotaKey({ userId, channel, purpose, providerKind, date })
//         );
//       }

//       return {
//         status: 429,
//         code: "monthly_quota_exceeded",
//         message: "Monthly send quota exceeded",
//         retryAfterSeconds: secondsUntil(period.end, date),
//       } as const;
//     }
//   }
// }

// export interface UsageBucketSnapshot {
//   daily: { used: number; limit: number | null };
//   monthly: { used: number; limit: number | null };
//   providerKind: ProviderKind;
//   purpose: MessagePurpose;
// }

// export interface UsageSnapshot {
//   billingUserId: string;
//   channels: {
//     email: {
//       buckets: UsageBucketSnapshot[];
//     };
//   };
//   limits: {
//     projects: number | null;
//     retention: number | null;
//     customDomains: number | null;
//     byoProviders: boolean;
//   };
//   period: { start: string; end: string };
//   plan: PlanName;
// }

// export async function getUsageSnapshot({
//   billingUserId,
//   redis,
//   now = new Date(),
// }: {
//   billingUserId: string;
//   redis: RedisClient;
//   now?: Date;
// }): Promise<UsageSnapshot> {
//   const { start, end, planName } = await resolveBillingPeriod(
//     billingUserId,
//     now
//   );
//   const plan = plans.find((p) => p.name === planName) ?? FREE_PLAN;
//   const limits = (plan.limits ?? FREE_PLAN.limits) as unknown as UserLimits;

//   const channelRow = await db.query.userChannel.findFirst({
//     where: (table, { eq: equals, and: andFn }) =>
//       andFn(
//         equals(table.userId, billingUserId),
//         equals(table.channelType, "email")
//       ),
//   });

//   const emailLimits = emailLimitsForEdition(
//     (channelRow?.limits ?? limits.email) as EmailLimits
//   );

//   const buckets: UsageBucketSnapshot[] = [];

//   for (const purpose of AVAILABLE_MESSAGE_PURPOSES) {
//     for (const providerKind of AVAILABLE_PROVIDER_KINDS) {
//       const bucket = getBucketLimits(emailLimits, purpose, providerKind);
//       const monthlyUsed = Number(
//         (await redis.get(
//           monthlyQuotaKey({
//             userId: billingUserId,
//             channel: "email",
//             purpose,
//             providerKind,
//             periodStart: start,
//           })
//         )) ?? 0
//       );
//       const dailyUsed = Number(
//         (await redis.get(
//           dailyQuotaKey({
//             userId: billingUserId,
//             channel: "email",
//             purpose,
//             providerKind,
//             date: now,
//           })
//         )) ?? 0
//       );

//       buckets.push({
//         purpose,
//         providerKind,
//         monthly: { used: monthlyUsed, limit: bucket.monthlySends },
//         daily: { used: dailyUsed, limit: bucket.dailySends },
//       });
//     }
//   }

//   const effectiveUserLimits = IS_CLOUD_EDITION
//     ? limits
//     : SELF_HOSTED_UNLIMITED_USER_LIMITS;

//   return {
//     billingUserId,
//     plan: planName,
//     period: { start: start.toISOString(), end: end.toISOString() },
//     limits: {
//       projects: effectiveUserLimits.projects,
//       retention: effectiveUserLimits.retention,
//       customDomains: emailLimits.customDomains,
//       byoProviders: emailLimits.byoProviders,
//     },
//     channels: {
//       email: { buckets },
//     },
//   };
// }
