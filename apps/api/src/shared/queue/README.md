# Queue

> **IDE docs:** Full API reference lives in JSDoc on `@repo/api/queue` (`queue`, `QueueDefinition`, etc.) and `@repo/api/tasks` (`task`, `TaskDefinition`, `TaskContext`, etc.) exports — hover or "Go to Definition" in your editor.

Background work for Relayit, built on **Redis streams**. This package gives you two ways to define async work:

- **`queue(def)`** — a general-purpose queue with **retry**, **delay**, and **dead-letter** support. Use this when you need at-least-once delivery and failure handling (e.g. sending an email).
- **`task(def)`** — a scheduler-oriented task with **deduplicated scheduling** and an optional **reconcile** hook. Use this for recurring background checks (e.g. domain verification) where the same logical job should only appear once in the schedule.

Both share the same low-level stream primitives under the hood (`XADD`, `XREADGROUP`, `XACK`, ZSET delay, consumer groups).

## Queue vs task — which one?

| | `queue` | `task` |
| --- | --- | --- |
| **Best for** | Fire-and-forget work with retries (sends, webhooks) | Recurring / deduplicated background checks |
| **Delay** | `enqueue(payload, { delay_until })` | `schedule(payload, dueAt)` |
| **Dedup** | No — each enqueue is a new message | Yes — `schedule`/`unschedule` key off `redis.member` |
| **Retry** | Built-in (exponential backoff + dead-letter) | No — handler errors are logged and acked |
| **Reconcile** | No | Optional `reconcile(ctx)` to repair schedule from DB |
| **Wire format** | JSON envelope `{ data, attempts, firstEnqueuedAt }` | Colon-joined member string from `redis.member` |
| **Key prefix** | `relayit:queue:<id>:…` | `relayit:task:<segments>:…` |

---

# Queues

## What is a queue?

A queue is a typed unit of async work identified by `id`. When work is ready:

1. A payload is written to a Redis stream (`XADD`) or scored into a delay ZSET (`ZADD`).
2. The worker reads from the stream via a consumer group (`XREADGROUP`), runs `process(payload, ctx)`, then acknowledges the message (`XACK`).
3. On failure, the queue either **retries** (re-scores into the delay ZSET with backoff) or moves the message to a **dead-letter stream**.
4. Delayed entries (initial `enqueue` with `delay_until`, or retries) are promoted from the ZSET into the stream on a cron tick.

## Quick start

```ts
import { queue } from "@repo/api/queue";
import * as z from "zod";

export const sendEmailQueue = queue({
  id: "email.send",
  payload: z.object({ messageId: z.string() }),
  async process({ messageId }, { redis, db }) {
    // load message, send via provider, update attempt row
  },
});
```

Enqueue immediately from server code:

```ts
await sendEmailQueue.with(redis).enqueue({ messageId: "emsg_123" });
```

Or delay until a specific time:

```ts
await sendEmailQueue.with(redis).enqueue(
  { messageId: "emsg_123" },
  { delay_until: new Date("2026-06-27T09:00:00Z") }
);
```

Register the queue in the worker (see [Worker registration](#worker-registration)).

## `queue(def)` options

### `id`

Stable queue identity (e.g. `"email.send"`). Used to build Redis keys under `relayit:queue:<id>:…`.

### `payload`

Zod schema for the queue payload. Drives TypeScript types for `process` and `enqueue`. Your handler receives the decoded `data` field — not the wire envelope.

### `process(payload, ctx)`

Required handler run for each stream message. `ctx` provides:

- `redis` — `RedisClient` (`send` only)
- `db` — shared Drizzle database handle

**Failure behaviour:**

- Throw a normal `Error` → retryable (up to `retry.maxAttempts`).
- Throw `QueueTerminalError` → non-retryable, goes straight to the dead-letter stream.

```ts
import { QueueTerminalError, queue } from "@repo/api/queue";

// inside process():
if (!message) {
  throw new QueueTerminalError("Message not found");
}
```

### `retry`

Optional retry tuning. Defaults:

| Field | Default | Description |
| --- | --- | --- |
| `maxAttempts` | `3` | Total processing attempts (including the first) |
| `backoff.baseMs` | `30000` | Base delay before the first retry |
| `backoff.maxMs` | `900000` (15 min) | Cap on exponential backoff |

Backoff is exponential: attempt 1 → 30s, attempt 2 → 60s, attempt 3 → 120s, etc., capped at `maxMs`.

### `deadLetter`

Whether to write exhausted or terminal failures to the dead-letter stream. Defaults to `true`. Set to `false` to drop failed messages after ack (not recommended for production sends).

### `hooks`

Optional lifecycle callbacks, defined on the queue (not on `.enqueue()` — see [Lifecycle hooks](#lifecycle-hooks)). Each hook may be sync or return a `Promise`; the worker always `await`s the result.

| Hook | When it runs |
| --- | --- |
| `onCompleted` | After `process` succeeds |
| `onAttemptFail` | After a failed attempt that **will** be retried |
| `onTerminalFail` | When the message is dead-lettered (terminal error or retries exhausted) |

Hook errors are logged and do not affect ack/retry behaviour.

### `worker`

Optional overrides for the worker loop. Defaults:

| Field | Default | When set |
| --- | --- | --- |
| `promoteCron` | `*/1 * * * *` | Cron that promotes due delay entries to the stream |
| `readCount` | `10` | Max messages per `XREADGROUP` batch |
| `blockTimeoutMs` | `5000` | Block timeout for stream reads |
| `minIdleMs` | `60000` | Minimum idle time before reclaiming pending messages |

## API on the returned queue

### Producer (`queue.with(redis)`)

| Method | Description |
| --- | --- |
| `enqueue(payload)` | Add work to the stream immediately (`XADD`) |
| `enqueue(payload, { delay_until })` | Score work into the delay ZSET for later promotion |

`delay_until` is optional — omit it or pass `{}` to enqueue immediately. When set, accepts a `Date` or epoch milliseconds.

### Worker

| Method | Description |
| --- | --- |
| `bootstrap(redis, consumerName)` | Ensure consumer group exists |
| `run(redis, consumerName, shouldContinue)` | Blocking process loop — read, `process`, ack/retry/dead-letter |
| `workerStream(redis, consumerName)` | Low-level stream handle (promote, reclaim, manual reads) |

Read-only metadata: `id`, `stream`, `group`, `delayKey`, `deadKey`, `worker`.

## Wire encoding (queues)

Redis stores a JSON string in the stream `payload` field and delay ZSET member:

```json
{
  "data": { "messageId": "emsg_123" },
  "attempts": 0,
  "firstEnqueuedAt": 1719388800000
}
```

- `data` — your typed payload (validated by the Zod schema).
- `attempts` — how many times processing has been attempted (0 on first enqueue).
- `firstEnqueuedAt` — epoch ms when the message was first enqueued.

On retry, `attempts` is incremented and the envelope is re-scored into the delay ZSET. Your `process` handler always receives just `data`.

Dead-letter entries extend the envelope with `failedAt` and `error`.

## Lifecycle hooks

Hooks must be defined on `queue({ hooks: { … } })`, not on `.enqueue(payload, options)`. Enqueue options only travel through Redis as JSON — functions cannot be serialized, and the worker may run in a separate process from the API.

```ts
export const sendEmailQueue = queue({
  id: "email.send",
  payload: z.object({ messageId: z.string() }),
  async process({ messageId }, { db }) {
    // send…
  },
  hooks: {
    onCompleted({ payload, meta, ctx }) {
      // sync is fine
    },
    async onAttemptFail({ payload, error, meta, ctx }) {
      // await db updates, etc.
    },
    async onTerminalFail({ payload, error, terminal, meta, ctx }) {
      // terminal === true when process threw QueueTerminalError
    },
  },
});
```

Each hook receives:

- `payload` — decoded queue data (same as `process` receives)
- `ctx` — `{ redis, db }`
- `meta` — `{ streamId, attempt, firstEnqueuedAt }` where `attempt` is 1-based

## Key naming convention (queues)

Keys follow:

```
relayit:queue:<id>:<suffix>
```

| Suffix | Redis type | Purpose |
| --- | --- | --- |
| `stream` | Stream | Work queue |
| `group` | Consumer group name (same pattern) | Stream consumer group id |
| `delay` | Sorted set | Delayed work and retries, scored by due time |
| `dead` | Stream | Dead-letter stream for terminal / exhausted failures |

Example for `id: "email.send"`:

```
relayit:queue:email.send:stream
relayit:queue:email.send:group
relayit:queue:email.send:delay
relayit:queue:email.send:dead
```

---

# Tasks

Tasks are for **scheduler-oriented** background work — the kind where you want one entry per logical job in the schedule ZSET, and you may need to repair that schedule from database state after a restart.

Each task is defined once with `task(def)` and exposes:

- a **producer** surface (`enqueue`, `schedule`, `unschedule`) for API routes and domain code
- a **worker** surface (`bootstrap`, `run`, `reconcile`, `workerStream`) for the worker process

## What is a task?

A task is a typed unit of async work identified by `id`. When work is ready:

1. A payload is written to a Redis stream (`XADD`) or scored into a schedule ZSET (`ZADD`).
2. The worker reads from the stream via a consumer group (`XREADGROUP`), runs `process(payload, ctx)`, then acknowledges the message (`XACK`).
3. Scheduled entries are promoted from the ZSET into the stream on a cron tick.

Optional `reconcile(ctx)` repairs the schedule from database state (e.g. after restarts or drift).

## Quick start

```ts
import { task } from "@repo/api/tasks";
import * as z from "zod";

export const verifyDomainTask = task({
  id: "email.verify-domain",
  payload: z.object({ domainId: z.string().min(1) }),
  redis: {
    member: (p) => [p.domainId],
  },
  async process({ domainId }, { redis, db }) {
    // check readiness, reschedule or unschedule
  },
});
```

Enqueue immediately from server code:

```ts
await verifyDomainTask.with(redis).enqueue({ domainId: "dom_123" });
```

Register the task in the worker (see [Worker registration](#worker-registration)).

## `task(def)` options

### `id`

Stable task identity (e.g. `"email.verify-domain"`). Used as the default segment when building Redis keys unless overridden.

### `payload`

Zod schema for the task payload. Drives TypeScript types for `process`, `schedule`, `enqueue`, and `unschedule`.

### `redis.stream` / `redis.group` / `redis.schedule`

Optional segment functions `(ctx) => string[]` where `ctx.id` is the task `id`. Each returns key path segments inserted between `relayit:task:` and the suffix.

Defaults to `[id]` for all three when omitted.

### `redis.member` (required)

`(payload) => string[]` — ordered segments for the wire identity. The package joins them with `:` into the Redis member string (stream field value and ZSET member). Must be stable and unique per logical job so scheduling and deduplication work.

- Single field: `member: (p) => [p.jobId]`
- Composite key: `member: (p) => [p.orgId, p.domainId]` — segment order must match field order in `payload`

### `worker`

Optional overrides for the worker loop. Defaults:

| Field | Default | When set |
| --- | --- | --- |
| `promoteCron` | `*/1 * * * *` | Cron that promotes due schedule entries to the stream |
| `readCount` | `10` | Max messages per `XREADGROUP` batch |
| `blockTimeoutMs` | `5000` | Block timeout for stream reads |
| `minIdleMs` | `60000` | Minimum idle time before reclaiming pending messages |
| `reconcileCron` | `*/10 * * * *` | Only when `reconcile` is defined; otherwise unset |

### `process(payload, ctx)`

Required handler run for each stream message. `ctx` provides:

- `redis` — `RedisClient` (`send` only)
- `db` — shared Drizzle database handle

Handler errors are logged and the message is still acknowledged — tasks do not retry automatically. Use `schedule`/`unschedule` inside `process` to control the next run.

### `reconcile(ctx)` (optional)

Periodic repair hook. Typically reads authoritative state from `db` and calls `task.with(redis).schedule(...)` (or `unschedule`) to align the Redis schedule ZSET.

## API on the returned task

### Producer (`task.with(redis)`)

| Method | Description |
| --- | --- |
| `enqueue(payload)` | Add work to the stream immediately (`XADD`) |
| `schedule(payload, dueAt)` | Score payload into the schedule ZSET for later promotion |
| `unschedule(payload)` | Remove a scheduled member from the ZSET |

`dueAt` accepts a `Date` or epoch milliseconds.

### Worker

| Method | Description |
| --- | --- |
| `bootstrap(redis, consumerName)` | Ensure consumer group exists; runs `reconcile` once if defined |
| `run(redis, consumerName, shouldContinue)` | Blocking process loop — read, `process`, ack |
| `reconcile(redis)` | Run the reconcile handler |
| `workerStream(redis, consumerName)` | Low-level stream handle for the worker package (promote, reclaim, etc.) |

Read-only metadata: `id`, `stream`, `group`, `scheduleKey`, `worker`.

## Wire encoding (tasks)

Redis always stores a single string per message (stream `payload` field and ZSET member).

The codec joins `redis.member` segments with `:` (same convention as task keys):

- **Single-field object** (e.g. `z.object({ jobId: z.string() })`): `member: (p) => [p.jobId]` → wire `"job_123"`.
- **Multi-field object** (e.g. `z.object({ orgId, domainId })`): `member: (p) => [p.orgId, p.domainId]` → wire `"org_1:dom_9"`. Decode splits on `:` and zips segments onto payload keys in schema declaration order.

Segment count must match the number of payload fields; mismatch fails decode. `redis.member` must round-trip with the schema — it defines both encoding for writes and the key used in the schedule ZSET.

## Key naming convention (tasks)

Keys follow:

```
relayit:task:<segments>:<suffix>
```

| Suffix | Redis type | Purpose |
| --- | --- | --- |
| `stream` | Stream | Work queue |
| `group` | Consumer group name (same pattern) | Stream consumer group id |
| `schedule` | Sorted set | Delayed work scored by due time |

Example for `id: "email.verify-domain"` with default segments:

```
relayit:task:email.verify-domain:stream
relayit:task:email.verify-domain:group
relayit:task:email.verify-domain:schedule
```

Custom segments:

```ts
redis: {
  stream: ({ id }) => ["tenant", "acme", id],
  member: (p) => [p.jobId],
}
// → relayit:task:tenant:acme:reports.process:stream
```

---

# Worker registration

Export queues and tasks from feature modules, then list them in the worker registry:

```ts
// worker/lib/tasks.ts
import { verifyDomainTask } from "@repo/api/channels/email/tasks/verify-domain";
import { verifyOwnershipTask } from "@repo/api/channels/email/tasks/verify-ownership";
import { verifyProviderTask } from "@repo/api/channels/email/tasks/verify-provider";
import type { Task } from "@repo/api/tasks";

export const WORKER_TASKS = [
  verifyDomainTask,
  verifyOwnershipTask,
  verifyProviderTask,
] satisfies Task<unknown>[];

// When you add queues:
// import { sendEmailQueue } from "@repo/api/channels/email/queues/send";
// import type { Queue } from "@repo/api/queue";
//
// export const WORKER_QUEUES = [sendEmailQueue] satisfies Queue<unknown>[];
```

The worker process calls `bootstrap`, starts crons for promote (and reconcile when defined on tasks), and runs `run` for each registered queue and task. Queues and tasks share the same worker surface shape (`bootstrap`, `run`, `workerStream`, `worker.promoteCron`) so the worker host can treat them uniformly.
