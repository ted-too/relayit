import type { RedisClient } from "bun";
import type * as z from "zod";

/**
 * Failure states a circuit moves through.
 *
 * - `closed`: healthy; calls are allowed and failures accumulate toward the
 *   threshold.
 * - `open`: threshold tripped; calls are rejected until the cooldown elapses.
 * - `half_open`: cooldown elapsed; a single trial call is allowed. A success
 *   closes the circuit, a failure re-opens it for another cooldown.
 */
export type CircuitState = "closed" | "open" | "half_open";

/** Trip/recovery policy. Omitted fields fall back to {@link DEFAULT_CIRCUIT_POLICY}. */
export interface CircuitBreakerPolicy {
  /** How long the circuit stays `open` before a half-open trial. @defaultValue `60000` (1 min) */
  cooldownMs?: number;
  /** Consecutive failures that trip the circuit `open`. @defaultValue `5` */
  failureThreshold?: number;
  /**
   * How long failure counts linger without new failures. Defaults to
   * `cooldownMs`; a burst of failures self-clears after this idle window.
   */
  failureWindowMs?: number;
}

export const DEFAULT_CIRCUIT_POLICY = {
  failureThreshold: 5,
  cooldownMs: 60_000,
} satisfies CircuitBreakerPolicy;

/** Thrown by {@link CircuitBreakerClient.run} when the circuit is not accepting calls. */
export class CircuitOpenError extends Error {
  constructor(id: string, member: string) {
    super(`Circuit "${id}" is open for "${member}"`);
    this.name = "CircuitOpenError";
  }
}

/**
 * Producer-side API bound to a Redis client.
 *
 * Obtain an instance with {@link CircuitBreaker.with}. Safe to share across the
 * API and worker processes that use the same Redis connection.
 */
export interface CircuitBreakerClient<Payload> {
  /** `true` when a call may proceed (state `closed` or `half_open`). */
  allow(payload: Payload): Promise<boolean>;

  /** Count a failure; trips the circuit `open` once the threshold is reached. */
  recordFailure(payload: Payload): Promise<void>;

  /** Reset the circuit to `closed`, clearing accumulated failures. */
  recordSuccess(payload: Payload): Promise<void>;

  /**
   * Guard `fn` with the breaker: reject with {@link CircuitOpenError} when not
   * allowed, otherwise run it and record the outcome.
   */
  run<T>(payload: Payload, fn: () => Promise<T>): Promise<T>;

  /** Current {@link CircuitState} for the member. */
  state(payload: Payload): Promise<CircuitState>;
}

/**
 * A registered circuit breaker with a stable Redis key layout.
 *
 * Returned by {@link circuitBreaker}. Register once and reuse via
 * {@link CircuitBreaker.with}.
 */
export interface CircuitBreaker<Payload> {
  /** Stable breaker identity from {@link CircuitBreakerDefinition.id}. */
  readonly id: string;

  /** Resolved Redis state key for a member (`relayit:breaker:…`). */
  key(payload: Payload): string;

  /** Bind the breaker to a Redis client for state operations. */
  with(redis: RedisClient): CircuitBreakerClient<Payload>;
}

/**
 * Definition passed to {@link circuitBreaker}.
 *
 * Mirrors {@link TaskDefinition}: a stable `id`, a Zod `payload` describing the
 * guarded resource, and a `redis.member` mapping the payload to key segments.
 */
export interface CircuitBreakerDefinition<
  PayloadSchema extends z.ZodType,
  Payload = z.infer<PayloadSchema>,
> {
  /** Stable identity (e.g. `"email.provider"`); the default Redis key segment. */
  id: string;

  /** Zod schema for the guarded-resource identifier. Infers `Payload`. */
  payload: PayloadSchema;

  /** Trip/recovery policy. Omitted fields use {@link DEFAULT_CIRCUIT_POLICY}. */
  policy?: CircuitBreakerPolicy;

  /** Redis key encoding. */
  redis: {
    /**
     * Ordered segments uniquely identifying the guarded resource, joined with
     * `:` into the Redis member string. E.g. `member: (p) => [p.providerId]`.
     */
    member: (payload: Payload) => string[];
  };
}

function breakerKey(id: string, member: string[]) {
  return `relayit:breaker:${id}:${member.join(":")}`;
}

interface CircuitSnapshot {
  failures: number;
  openedAt: number;
}

async function readSnapshot(
  redis: RedisClient,
  key: string
): Promise<CircuitSnapshot> {
  const raw = (await redis.send("HMGET", [key, "failures", "openedAt"])) as
    | (string | null)[]
    | null;

  return {
    failures: Number(raw?.[0] ?? 0),
    openedAt: Number(raw?.[1] ?? 0),
  };
}

function resolveState(
  snapshot: CircuitSnapshot,
  cooldownMs: number,
  now: number
): CircuitState {
  if (snapshot.openedAt <= 0) {
    return "closed";
  }
  return now - snapshot.openedAt >= cooldownMs ? "half_open" : "open";
}

/**
 * Define a Redis-backed circuit breaker for a class of guarded resources.
 *
 * Follows the same factory + {@link CircuitBreaker.with} shape as
 * {@link task}/{@link queue}: one definition, reused across processes, keyed per
 * member so each resource (e.g. a provider) trips independently.
 *
 * @example
 * ```ts
 * const providerBreaker = circuitBreaker({
 *   id: "email.provider",
 *   payload: z.object({ providerId: z.string() }),
 *   redis: { member: (p) => [p.providerId] },
 *   policy: { failureThreshold: 5, cooldownMs: 60_000 },
 * });
 *
 * const breaker = providerBreaker.with(redis);
 * if (await breaker.allow({ providerId })) {
 *   try {
 *     await send();
 *     await breaker.recordSuccess({ providerId });
 *   } catch (error) {
 *     await breaker.recordFailure({ providerId });
 *   }
 * }
 * ```
 */
export function circuitBreaker<PayloadSchema extends z.ZodType>(
  def: CircuitBreakerDefinition<PayloadSchema>
): CircuitBreaker<z.infer<PayloadSchema>> {
  type Payload = z.infer<PayloadSchema>;

  const failureThreshold =
    def.policy?.failureThreshold ?? DEFAULT_CIRCUIT_POLICY.failureThreshold;
  const cooldownMs =
    def.policy?.cooldownMs ?? DEFAULT_CIRCUIT_POLICY.cooldownMs;
  const failureWindowMs = def.policy?.failureWindowMs ?? cooldownMs;
  const ttlMs = Math.max(cooldownMs, failureWindowMs);

  const keyFor = (payload: Payload) =>
    breakerKey(def.id, def.redis.member(payload));

  return {
    id: def.id,
    key: keyFor,

    with(redis) {
      const client: CircuitBreakerClient<Payload> = {
        async state(payload) {
          const key = keyFor(payload);
          const snapshot = await readSnapshot(redis, key);
          return resolveState(snapshot, cooldownMs, Date.now());
        },

        async allow(payload) {
          const key = keyFor(payload);
          const snapshot = await readSnapshot(redis, key);
          return resolveState(snapshot, cooldownMs, Date.now()) !== "open";
        },

        async recordSuccess(payload) {
          await redis.send("DEL", [keyFor(payload)]);
        },

        async recordFailure(payload) {
          const key = keyFor(payload);
          const failures = Number(
            await redis.send("HINCRBY", [key, "failures", "1"])
          );

          // Trip (or re-trip on a failed half-open trial) once at threshold.
          if (failures >= failureThreshold) {
            await redis.send("HSET", [key, "openedAt", String(Date.now())]);
          }

          await redis.send("PEXPIRE", [key, String(ttlMs)]);
        },

        async run(payload, fn) {
          if (!(await client.allow(payload))) {
            throw new CircuitOpenError(
              def.id,
              def.redis.member(payload).join(":")
            );
          }

          try {
            const result = await fn();
            await client.recordSuccess(payload);
            return result;
          } catch (error) {
            await client.recordFailure(payload);
            throw error;
          }
        },
      };

      return client;
    },
  };
}
