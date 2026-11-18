import type { ChannelType, MessagePurpose } from "@repo/persistence/db/schema";
import type { RedisService } from "@repo/redis";

const RESERVATION_KEY_PREFIX = "relayit:usage:reservation";
const COUNTER_KEY_PREFIX = "relayit:usage";
export const USAGE_TOMBSTONE_TTL_SECONDS = 90 * 24 * 60 * 60;

const RESERVE_SCRIPT = `
local reservation = KEYS[1]
local daily = KEYS[2]
local monthly = KEYS[3]
local fingerprint = ARGV[1]
local dailyLimit = tonumber(ARGV[2])
local monthlyLimit = tonumber(ARGV[3])
local dailyTtl = tonumber(ARGV[4])
local monthlyTtl = tonumber(ARGV[5])

if redis.call("EXISTS", reservation) == 1 then
  if redis.call("HGET", reservation, "fingerprint") == fingerprint then
    return 0
  end
  return 3
end

if dailyLimit >= 0 then
  local dailyCount = redis.call("INCR", daily)
  if dailyCount == 1 then redis.call("EXPIRE", daily, dailyTtl) end
  if dailyCount > dailyLimit then
    redis.call("DECR", daily)
    return 1
  end
end

if monthlyLimit >= 0 then
  local monthlyCount = redis.call("INCR", monthly)
  if monthlyCount == 1 then redis.call("EXPIRE", monthly, monthlyTtl) end
  if monthlyCount > monthlyLimit then
    redis.call("DECR", monthly)
    if dailyLimit >= 0 then redis.call("DECR", daily) end
    return 2
  end
end

redis.call("HSET", reservation,
  "fingerprint", fingerprint,
  "organizationId", ARGV[6],
  "billingUserId", ARGV[7],
  "channel", ARGV[8],
  "purpose", ARGV[9],
  "reservedAt", ARGV[10],
  "periodStart", ARGV[11],
  "periodEnd", ARGV[12],
  "dailyKey", daily,
  "monthlyKey", monthly,
  "status", "reserved"
)
return 0
`;

const CONFIRM_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 0 then return 4 end
local status = redis.call("HGET", KEYS[1], "status")
if status == "released" then return 5 end
if status == "reserved" then redis.call("HSET", KEYS[1], "status", "confirmed") end
redis.call("EXPIRE", KEYS[1], ARGV[1])
return 0
`;

const RELEASE_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 0 then return 4 end
local status = redis.call("HGET", KEYS[1], "status")
if status == "released" or status == "confirmed" then
  redis.call("EXPIRE", KEYS[1], ARGV[1])
  return 0
end

local daily = redis.call("HGET", KEYS[1], "dailyKey")
local monthly = redis.call("HGET", KEYS[1], "monthlyKey")
if redis.call("GET", daily) and tonumber(redis.call("GET", daily)) > 0 then
  redis.call("DECR", daily)
end
if redis.call("GET", monthly) and tonumber(redis.call("GET", monthly)) > 0 then
  redis.call("DECR", monthly)
end

redis.call("HSET", KEYS[1], "status", "released")
redis.call("EXPIRE", KEYS[1], ARGV[1])
return 0
`;

export interface UsageLedgerDimensions {
  readonly channel: ChannelType;
  readonly organizationId: string;
  readonly purpose: MessagePurpose;
  readonly reservedAt: string;
}

export interface UsageLedgerPolicy {
  readonly billingUserId: string;
  readonly dailyLimit: number | null;
  readonly monthlyLimit: number | null;
  readonly periodEnd: Date;
  readonly periodStart: Date;
}

const reservationKey = (deliveryId: string) => `${RESERVATION_KEY_PREFIX}:${deliveryId}`;

const secondsUntil = (end: Date, from: Date) =>
  Math.max(1, Math.ceil((end.getTime() - from.getTime()) / 1000));

const secondsUntilDayEnd = (date: Date) =>
  secondsUntil(
    new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1)),
    date,
  );

const counterKeys = (policy: UsageLedgerPolicy, input: UsageLedgerDimensions) => ({
  daily: `${COUNTER_KEY_PREFIX}:${policy.billingUserId}:${input.channel}:${input.purpose}:day:${input.reservedAt.slice(0, 10)}`,
  monthly: `${COUNTER_KEY_PREFIX}:${policy.billingUserId}:${input.channel}:${input.purpose}:period:${policy.periodStart.toISOString()}`,
});

const fingerprintOf = (input: UsageLedgerDimensions, billingUserId: string) =>
  JSON.stringify({
    billingUserId,
    channel: input.channel,
    organizationId: input.organizationId,
    purpose: input.purpose,
    reservedAt: input.reservedAt,
  });

const limitArg = (limit: number | null) => String(limit ?? -1);

export const makeUsageLedger = (redis: RedisService) => ({
  confirm: (deliveryId: string) =>
    redis.evaluateNumber({
      args: [String(USAGE_TOMBSTONE_TTL_SECONDS)],
      keys: [reservationKey(deliveryId)],
      script: CONFIRM_SCRIPT,
    }),
  release: (deliveryId: string) =>
    redis.evaluateNumber({
      args: [String(USAGE_TOMBSTONE_TTL_SECONDS)],
      keys: [reservationKey(deliveryId)],
      script: RELEASE_SCRIPT,
    }),
  reserve: (deliveryId: string, input: UsageLedgerDimensions, policy: UsageLedgerPolicy) => {
    const keys = counterKeys(policy, input);
    const reservedAt = new Date(input.reservedAt);
    return redis.evaluateNumber({
      args: [
        fingerprintOf(input, policy.billingUserId),
        limitArg(policy.dailyLimit),
        limitArg(policy.monthlyLimit),
        String(secondsUntilDayEnd(reservedAt)),
        String(secondsUntil(policy.periodEnd, reservedAt)),
        input.organizationId,
        policy.billingUserId,
        input.channel,
        input.purpose,
        input.reservedAt,
        policy.periodStart.toISOString(),
        policy.periodEnd.toISOString(),
      ],
      keys: [reservationKey(deliveryId), keys.daily, keys.monthly],
      script: RESERVE_SCRIPT,
    });
  },
});
