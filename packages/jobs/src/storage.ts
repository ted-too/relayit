import { makeSchemaJsonCodec } from "@repo/redis";
import { Effect, Schema } from "effect";
import type { Job, JobSchema } from "./job";

export const REDIS_PAYLOAD_FIELD = "payload";
export const JOB_WORKER_GROUP = "relayit:jobs:workers";

export const jobKeys = (name: string) => ({
  delayed: `relayit:jobs:${name}:delayed`,
  payloads: `relayit:jobs:${name}:payloads`,
  ready: `relayit:jobs:${name}:ready`,
  scheduled: `relayit:jobs:${name}:scheduled`,
  workers: JOB_WORKER_GROUP,
});

export const jobEnvelopeSchema = Schema.Struct({
  attempts: Schema.Finite,
  data: Schema.String,
  firstEnqueuedAt: Schema.Finite,
  wireVersion: Schema.Literal(1),
});

const jobEnvelopeCodec = makeSchemaJsonCodec(jobEnvelopeSchema);

/** Identity-keyed schedule: HASH payloads[identity]=envelope, ZSET scheduled[identity]=runAt. */
export const SCHEDULE_RECURRING_JOB_SCRIPT = `
redis.call("HSET", KEYS[2], ARGV[2], ARGV[3])
return redis.call("ZADD", KEYS[1], ARGV[1], ARGV[2])
`;

export const CANCEL_RECURRING_JOB_SCRIPT = `
local removed = redis.call("ZREM", KEYS[1], ARGV[1])
redis.call("HDEL", KEYS[2], ARGV[1])
return removed
`;

export const PROMOTE_DELAYED_JOBS_SCRIPT = `
local due = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", ARGV[1], "LIMIT", 0, ARGV[2])
for _, payload in ipairs(due) do
  redis.call("XADD", KEYS[2], "*", "${REDIS_PAYLOAD_FIELD}", payload)
  redis.call("ZREM", KEYS[1], payload)
end
return #due
`;

/** Promote identity-scheduled envelopes onto the ready stream. */
export const PROMOTE_SCHEDULED_JOBS_SCRIPT = `
local due = redis.call("ZRANGEBYSCORE", KEYS[1], "-inf", ARGV[1], "LIMIT", 0, ARGV[2])
local promoted = 0
for _, identity in ipairs(due) do
  local payload = redis.call("HGET", KEYS[2], identity)
  if payload then
    redis.call("XADD", KEYS[3], "*", "${REDIS_PAYLOAD_FIELD}", payload)
    promoted = promoted + 1
  end
  redis.call("ZREM", KEYS[1], identity)
  redis.call("HDEL", KEYS[2], identity)
end
return promoted
`;

export const encodeJob = <
  const Name extends string,
  PayloadSchema extends JobSchema,
>(
  contract: Job<Name, PayloadSchema>,
  payload: PayloadSchema["Type"],
  firstEnqueuedAt: number
) =>
  Effect.gen(function* () {
    const data = yield* makeSchemaJsonCodec(contract.payload).encode(payload);
    return yield* jobEnvelopeCodec.encode({
      attempts: 0,
      data,
      firstEnqueuedAt,
      wireVersion: 1,
    });
  }) as Effect.Effect<string, unknown>;
