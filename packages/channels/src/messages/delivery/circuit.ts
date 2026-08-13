import { Redis } from "@repo/redis";
import { Clock, Effect } from "effect";
import { MessageDeliveryInfrastructureError } from "./errors";

const FAILURE_THRESHOLD = 5;
const COOLDOWN_MS = 60_000;
const TTL_MS = COOLDOWN_MS;

const breakerKey = (providerId: string) =>
  `relayit:breaker:provider:${providerId}`;

/**
 * Returns 1 when the call may proceed (closed or half_open), else 0.
 * ARGV[1] = nowMillis, ARGV[2] = cooldownMs
 */
const ALLOW_SCRIPT = `
local failures = tonumber(redis.call("HGET", KEYS[1], "failures") or "0")
local openedAt = tonumber(redis.call("HGET", KEYS[1], "openedAt") or "0")
local now = tonumber(ARGV[1])
local cooldown = tonumber(ARGV[2])
if openedAt <= 0 then return 1 end
if now - openedAt >= cooldown then return 1 end
return 0
`;

/**
 * Increments failures; trips open at threshold. Returns failures after increment.
 * ARGV[1] = nowMillis, ARGV[2] = failureThreshold, ARGV[3] = ttlMs
 */
const RECORD_FAILURE_SCRIPT = `
local failures = tonumber(redis.call("HINCRBY", KEYS[1], "failures", 1))
local threshold = tonumber(ARGV[2])
if failures >= threshold then
  redis.call("HSET", KEYS[1], "openedAt", ARGV[1])
end
redis.call("PEXPIRE", KEYS[1], ARGV[3])
return failures
`;

/**
 * Clears breaker state after a successful send.
 */
const RECORD_SUCCESS_SCRIPT = `
return redis.call("DEL", KEYS[1])
`;

export const providerCircuitAllow = (providerId: string) =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    const now = yield* Clock.currentTimeMillis;
    const allowed = yield* redis
      .evaluateNumber({
        args: [String(now), String(COOLDOWN_MS)],
        keys: [breakerKey(providerId)],
        script: ALLOW_SCRIPT,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new MessageDeliveryInfrastructureError({
              cause,
              operation: "circuit",
            })
        )
      );
    return allowed === 1;
  });

export const providerCircuitRecordFailure = (providerId: string) =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    const now = yield* Clock.currentTimeMillis;
    yield* redis
      .evaluateNumber({
        args: [String(now), String(FAILURE_THRESHOLD), String(TTL_MS)],
        keys: [breakerKey(providerId)],
        script: RECORD_FAILURE_SCRIPT,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new MessageDeliveryInfrastructureError({
              cause,
              operation: "circuit",
            })
        )
      );
  });

export const providerCircuitRecordSuccess = (providerId: string) =>
  Effect.gen(function* () {
    const redis = yield* Redis;
    yield* redis
      .evaluateNumber({
        args: [],
        keys: [breakerKey(providerId)],
        script: RECORD_SUCCESS_SCRIPT,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new MessageDeliveryInfrastructureError({
              cause,
              operation: "circuit",
            })
        )
      );
  });
