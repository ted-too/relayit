import { db } from "@repo/api/db";
import {
  createProducerStream,
  createWorkerStream,
  type ProducerStream,
  type StreamConfig,
  type StreamPayloadCodec,
  type WorkerStream,
} from "@repo/api/queue";
import { logger } from "@repo/api/utils";
import type { RedisClient } from "bun";
import * as z from "zod";

const DEFAULT_STREAM_BLOCK_TIMEOUT_MS = 5000;

/**
 * Tuning options for the worker loop and background schedulers that drive a task.
 *
 * Values are resolved when {@link task} is called: caller overrides in
 * `TaskDefinition.worker` are merged onto {@link DEFAULT_TASK_WORKER_OPTIONS}.
 * `reconcileCron` is only set when the task defines `reconcile`; otherwise it
 * stays `undefined` even if passed in `worker`.
 */
export interface TaskWorkerOptions {
  /**
   * How long the consumer blocks on `XREADGROUP` when no messages are available.
   * Lower values react faster; higher values reduce Redis polling load.
   *
   * @defaultValue `5000` (from {@link DEFAULT_TASK_WORKER_OPTIONS})
   */
  blockTimeoutMs?: number;

  /**
   * Minimum idle time (milliseconds) before a pending message is eligible for
   * reclaim via `XAUTOCLAIM`.
   *
   * @defaultValue `60000`
   */
  minIdleMs?: number;

  /**
   * Cron expression for promoting due entries from the schedule ZSET into the
   * stream. Runs independently of the main `run` consume loop.
   *
   * @defaultValue `"*\/1 * * * *"` (every minute)
   */
  promoteCron: string;

  /**
   * Maximum number of stream messages to read per `XREADGROUP` call inside
   * {@link Task.run}.
   *
   * @defaultValue `10`
   */
  readCount: number;

  /**
   * Cron expression for invoking {@link Task.reconcile}. Only applied when the
   * task defines a `reconcile` handler; omitted otherwise.
   *
   * @defaultValue `"*\/10 * * * *"` when `reconcile` is defined
   */
  reconcileCron?: string;
}

/** Default worker tuning merged before per-task `worker` overrides. */
export const DEFAULT_TASK_WORKER_OPTIONS = {
  promoteCron: "*/1 * * * *",
  readCount: 10,
  blockTimeoutMs: DEFAULT_STREAM_BLOCK_TIMEOUT_MS,
  minIdleMs: 60_000,
} satisfies Omit<TaskWorkerOptions, "reconcileCron">;

const DEFAULT_RECONCILE_CRON = "*/10 * * * *";

/**
 * Shared runtime dependencies passed to task handlers.
 *
 * @remarks
 * Handlers receive `(payload, ctx)` with the typed payload first. The context
 * object is the extension point for injectables (database, Redis, and future
 * services); pass the same shape from API routes and the worker process.
 */
export interface TaskContext {
  /** Drizzle database handle for domain reads and writes inside handlers. */
  db: typeof db;

  /**
   * Redis client used for streams, schedule ZSETs, and any handler-side cache
   * or locking. See {@link RedisClient}.
   */
  redis: RedisClient;
}

type SegmentFn = (ctx: { id: string }) => string[];

function taskKey(segments: string[], suffix: "stream" | "group" | "schedule") {
  return `relayit:task:${segments.join(":")}:${suffix}`;
}

function memberWire(segments: string[]): string {
  return segments.join(":");
}

const defaultSegments: SegmentFn = ({ id }) => [id];

function isZodObject(schema: z.ZodType): schema is z.ZodObject<z.ZodRawShape> {
  return schema instanceof z.ZodObject;
}

function buildPayloadCodec<Payload>(
  payloadSchema: z.ZodType<Payload>,
  member: (payload: Payload) => string[]
): StreamPayloadCodec<Payload> {
  const shape = isZodObject(payloadSchema)
    ? Object.keys(payloadSchema.shape)
    : [];

  return z.codec(z.string().min(1), payloadSchema, {
    encode: (payload) => memberWire(member(payload as Payload)),
    decode: (wire) => {
      const segments = wire.split(":");

      if (segments.length !== shape.length) {
        throw new z.ZodError([
          {
            code: "custom",
            path: [],
            message: `Expected ${shape.length} member segment(s), got ${segments.length}`,
          },
        ]);
      }

      const record = Object.fromEntries(
        shape.map((key, index) => [key, segments[index]])
      );

      const parsed = payloadSchema.safeParse(record);

      if (!parsed.success) {
        throw parsed.error;
      }

      return parsed.data;
    },
  });
}

/**
 * Producer-side API bound to a Redis client.
 *
 * Obtain an instance with {@link Task.with}. Safe to use from API routes,
 * domain services, and scripts that share the app's Redis connection.
 */
export interface TaskClient<Payload> {
  /**
   * Append work to the task stream immediately (`XADD`).
   *
   * @param payload - Validated task payload; encoded with `redis.member`.
   * @returns `Result` with the new stream entry ID on success.
   */
  enqueue(payload: Payload): ReturnType<ProducerStream<Payload>["enqueue"]>;

  /**
   * Queue work for delayed execution by scoring it into the schedule ZSET
   * (`ZADD`). Due entries are promoted into the stream on the promote cron tick.
   *
   * @param payload - Validated task payload; becomes the ZSET member (via `redis.member`).
   * @param dueAt - Absolute time when the job should run (Date or epoch ms).
   * @returns `Result` with the number of elements added (0 or 1).
   */
  schedule(
    payload: Payload,
    dueAt: Date | number
  ): ReturnType<ProducerStream<Payload>["schedule"]>;

  /**
   * Remove a scheduled entry from the ZSET (`ZREM`) without enqueueing it.
   *
   * @param payload - Payload identifying the member to remove (same encoding as `schedule`).
   * @returns `Result` with the number of elements removed.
   */
  unschedule(
    payload: Payload
  ): ReturnType<ProducerStream<Payload>["unschedule"]>;
}

/**
 * A registered background task with producer and worker surfaces.
 *
 * Returned by {@link task}. The same object is used in the API (via
 * {@link Task.with}) and in the worker process ({@link Task.bootstrap},
 * {@link Task.run}, {@link Task.reconcile}).
 */
export interface Task<Payload> {
  /**
   * One-time worker startup: ensure the consumer group exists and run an
   * initial {@link Task.reconcile} when configured.
   *
   * @param redis - Worker Redis client.
   * @param consumerName - Unique name for this consumer within the group (e.g. hostname + pid).
   */
  bootstrap(redis: RedisClient, consumerName: string): Promise<void>;

  /** Resolved Redis consumer group name (`relayit:task:…:group`). */
  readonly group: string;

  /** Stable task identifier from {@link TaskDefinition.id}. */
  readonly id: string;

  /**
   * Run the optional reconcile handler against current database state.
   *
   * Called from `bootstrap`, on the reconcile cron, and manually when repairing
   * schedule drift. No-op when the task has no `reconcile` definition.
   *
   * @param redis - Worker Redis client.
   */
  reconcile(redis: RedisClient): Promise<void>;

  /**
   * Blocking consume loop: read messages from the stream, invoke `process`, then
   * acknowledge (`XACK`). Exits when `shouldContinue` returns `false`.
   *
   * Errors on individual messages are logged; the loop retries after a short
   * backoff. Does not run promote or reconcile crons — register those
   * separately in the worker host.
   *
   * @param redis - Worker Redis client.
   * @param consumerName - Consumer name passed to {@link Task.workerStream}.
   * @param shouldContinue - Called each iteration; return `false` to shut down gracefully.
   */
  run(
    redis: RedisClient,
    consumerName: string,
    shouldContinue: () => boolean
  ): Promise<void>;

  /** Resolved Redis schedule ZSET key (`relayit:task:…:schedule`). */
  readonly scheduleKey: string;

  /** Resolved Redis stream key (`relayit:task:…:stream`). */
  readonly stream: string;

  /**
   * Bind this task to a Redis client for producer operations.
   *
   * @param redis - Redis client (typically the API or worker shared instance).
   * @returns {@link TaskClient} with `enqueue`, `schedule`, and `unschedule`.
   */
  with(redis: RedisClient): TaskClient<Payload>;

  /** Fully resolved worker options after defaults and `reconcile` gating. */
  readonly worker: TaskWorkerOptions;

  /**
   * Low-level stream handle for custom worker integrations (promote, reclaim,
   * manual reads). Most apps use {@link Task.run} instead.
   *
   * @param redis - Worker Redis client.
   * @param consumerName - Consumer name for the group.
   */
  workerStream(redis: RedisClient, consumerName: string): WorkerStream<Payload>;
}

/**
 * Definition object passed to {@link task}.
 *
 * Describes identity, payload schema, Redis key layout, handlers, and optional
 * worker overrides. Register the returned {@link Task} once and reuse it across
 * API and worker processes.
 */
export interface TaskDefinition<
  PayloadSchema extends z.ZodType,
  Payload = z.infer<PayloadSchema>,
> {
  /**
   * Stable task identity (e.g. `"reports.process"`). Used as the default Redis
   * key segment and for logging. Choose a dotted namespace that won't collide
   * with other tasks.
   */
  id: string;

  /**
   * Zod schema for the task payload. Infers `Payload` for `process`, `schedule`,
   * and `unschedule`. Field declaration order must match `redis.member` segment
   * order — the codec zips wire segments onto these keys on decode.
   */
  payload: PayloadSchema;

  /**
   * Handler invoked for each stream message after decode.
   *
   * @param payload - Typed payload from the stream or promoted schedule entry.
   * @param ctx - {@link TaskContext} with `db` and `redis`.
   */
  process(payload: Payload, ctx: TaskContext): Promise<void>;

  /**
   * Optional repair hook that syncs the schedule ZSET with authoritative state
   * (usually the database). Use after restarts, deploys, or when schedule
   * entries may have drifted. When provided, {@link TaskWorkerOptions.reconcileCron}
   * defaults to every 10 minutes unless overridden in `worker`.
   *
   * @param ctx - {@link TaskContext}; no payload — reconcile operates on global/task state.
   */
  reconcile?: (ctx: TaskContext) => Promise<void>;

  /** Redis key encoding and optional segment overrides. */
  redis: {
    /**
     * Ordered segments for the schedule/stream wire identity. The package joins
     * them with `:` into the Redis member string (same separator as task keys).
     *
     * Must be deterministic and unique per logical job. Required — there is no
     * default.
     *
     * Single-field payloads: `member: (p) => [p.jobId]`.
     * Composite keys: `member: (p) => [p.orgId, p.customDomainId]` — segment order
     * must match field order in `payload`.
     */
    member: (payload: Payload) => string[];

    /**
     * Optional extra segments for the consumer group key. Combined as
     * `relayit:task:${segments.join(":")}:group`.
     *
     * @defaultValue `({ id }) => [id]`
     */
    group?: SegmentFn;

    /**
     * Optional extra segments for the schedule ZSET key. Combined as
     * `relayit:task:${segments.join(":")}:schedule`.
     *
     * @defaultValue `({ id }) => [id]`
     */
    schedule?: SegmentFn;

    /**
     * Optional extra segments for the stream key. Combined as
     * `relayit:task:${segments.join(":")}:stream`.
     *
     * @defaultValue `({ id }) => [id]`
     */
    stream?: SegmentFn;
  };

  /**
   * Partial overrides for {@link TaskWorkerOptions}. Omitted fields use
   * {@link DEFAULT_TASK_WORKER_OPTIONS}. `reconcileCron` is only honored when
   * `reconcile` is defined.
   */
  worker?: Partial<TaskWorkerOptions>;
}

/**
 * Define a background task backed by Redis streams and an optional schedule ZSET.
 *
 * Returns a {@link Task} with resolved Redis keys, a typed producer client
 * ({@link Task.with}), and worker entry points ({@link Task.bootstrap},
 * {@link Task.run}, {@link Task.reconcile}).
 *
 * **Lifecycle overview**
 *
 * 1. **Enqueue** — `with(redis).enqueue(payload)` writes to the stream immediately.
 * 2. **Schedule** — `with(redis).schedule(payload, dueAt)` scores a member into the ZSET; a promote cron moves due members into the stream.
 * 3. **Process** — the worker's `run` loop reads via a consumer group, calls `process(payload, ctx)`, then acknowledges.
 * 4. **Reconcile** (optional) — `reconcile(ctx)` repairs scheduled work from durable state.
 *
 * @param def - Task definition: id, payload schema, Redis mapping, and handlers.
 * @returns A {@link Task} registered with frozen key names and resolved worker options.
 *
 * @example Immediate enqueue from an API route
 * ```ts
 * import { task } from "@repo/api/tasks";;
 * import * as z from "zod";
 *
 * const processReportTask = task({
 *   id: "reports.process",
 *   payload: z.object({ jobId: z.string() }),
 *   redis: { member: (p) => [p.jobId] },
 *   async process({ jobId }, ctx) {
 *     await ctx.db.update(reports).set({ status: "processing" }).where(eq(reports.id, jobId));
 *   },
 * });
 *
 * await processReportTask.with(redis).enqueue({ jobId: "job_123" });
 * ```
 *
 * @example Scheduled work with reconcile
 * ```ts
 * const sendReminderTask = task({
 *   id: "reminders.send",
 *   payload: z.object({ userId: z.string(), campaignId: z.string() }),
 *   redis: { member: (p) => [p.userId, p.campaignId] },
 *   async process(payload, ctx) {
 *     // send email…
 *   },
 *   async reconcile(ctx) {
 *     // re-ZADD rows from DB where next_send_at is set
 *   },
 *   worker: { readCount: 5 },
 * });
 *
 * await sendReminderTask.with(redis).schedule(
 *   { userId: "u_1", campaignId: "c_9" },
 *   Date.now() + 86_400_000
 * );
 * ```
 *
 * @remarks
 * For narrative guides and operational notes, see `apps/api/src/queue/README.md`.
 */
export function task<PayloadSchema extends z.ZodType>(
  def: TaskDefinition<PayloadSchema>
): Task<z.infer<PayloadSchema>> {
  type Payload = z.infer<PayloadSchema>;

  const ctx = { id: def.id };
  const streamSegments = (def.redis.stream ?? defaultSegments)(ctx);
  const groupSegments = (def.redis.group ?? defaultSegments)(ctx);
  const scheduleSegments = (def.redis.schedule ?? defaultSegments)(ctx);

  const config: StreamConfig<Payload> & {
    group: string;
    scheduleKey: string;
  } = {
    stream: taskKey(streamSegments, "stream"),
    group: taskKey(groupSegments, "group"),
    scheduleKey: taskKey(scheduleSegments, "schedule"),
    codec: buildPayloadCodec(
      def.payload as z.ZodType<Payload>,
      def.redis.member
    ),
  };

  const producer = (redis: RedisClient) => createProducerStream(redis, config);

  const createTaskWorkerStream = (redis: RedisClient, consumer: string) =>
    createWorkerStream(redis, config, consumer);

  const workerOptions: TaskWorkerOptions = {
    ...DEFAULT_TASK_WORKER_OPTIONS,
    ...def.worker,
  };

  if (!def.reconcile) {
    workerOptions.reconcileCron = undefined;
  } else if (def.worker?.reconcileCron === undefined) {
    workerOptions.reconcileCron = DEFAULT_RECONCILE_CRON;
  }

  return {
    id: def.id,
    stream: config.stream,
    group: config.group,
    scheduleKey: config.scheduleKey,
    worker: workerOptions,

    workerStream(redis, consumer) {
      return createTaskWorkerStream(redis, consumer);
    },

    with(redis) {
      const stream = producer(redis);
      return {
        schedule: stream.schedule.bind(stream),
        unschedule: stream.unschedule.bind(stream),
        enqueue: stream.enqueue.bind(stream),
      };
    },

    async bootstrap(redis, consumerName) {
      const workerStream = createTaskWorkerStream(redis, consumerName);
      const groupResult = await workerStream.ensureGroup();

      if (groupResult.error) {
        throw groupResult.error;
      }

      if (def.reconcile) {
        await def.reconcile({ redis, db });
      }
    },

    async reconcile(redis) {
      if (def.reconcile) {
        await def.reconcile({ redis, db });
      }
    },

    async run(redis, consumerName, shouldContinue) {
      const workerStream = createTaskWorkerStream(redis, consumerName);
      const readCount = workerOptions.readCount;
      const blockTimeoutMs =
        workerOptions.blockTimeoutMs ?? DEFAULT_STREAM_BLOCK_TIMEOUT_MS;
      const minIdleMs = workerOptions.minIdleMs ?? 60_000;

      const handleEvent = async (event: { id: string; payload: Payload }) => {
        const startedAt = Date.now();
        logger.debug(
          { stream: config.stream, streamId: event.id, payload: event.payload },
          "Processing stream event"
        );

        try {
          await def.process(event.payload, { redis, db });
          logger.debug(
            {
              stream: config.stream,
              streamId: event.id,
              durationMs: Date.now() - startedAt,
            },
            "Processed stream event"
          );
        } catch (error) {
          logger.error(
            { stream: config.stream, streamId: event.id, error },
            "Failed to process stream event"
          );
        } finally {
          const ackResult = await workerStream.ack(event.id);
          if (ackResult.error) {
            logger.error(
              {
                stream: config.stream,
                streamId: event.id,
                error: ackResult.error,
              },
              "Failed to acknowledge stream event"
            );
          }
        }
      };

      let lastReclaimAt = 0;

      while (shouldContinue()) {
        try {
          // Periodically adopt messages stranded in a dead consumer's PEL (e.g.
          // a worker that crashed or was removed) so no work is lost.
          if (Date.now() - lastReclaimAt >= minIdleMs) {
            lastReclaimAt = Date.now();
            const claimResult = await workerStream.claimIdle({
              minIdleMs,
              count: readCount,
            });

            if (claimResult.error) {
              logger.error(
                { stream: config.stream, error: claimResult.error },
                "Failed to reclaim idle stream events"
              );
            } else if (claimResult.data.length > 0) {
              logger.debug(
                { stream: config.stream, count: claimResult.data.length },
                "Reclaimed idle stream events"
              );
              await Promise.allSettled(claimResult.data.map(handleEvent));
            }
          }

          const eventsResult = await workerStream.read({
            count: readCount,
            blockMs: blockTimeoutMs,
          });

          if (eventsResult.error) {
            logger.error(
              { stream: config.stream, error: eventsResult.error },
              "Failed to read stream events"
            );
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          }

          if (eventsResult.data.length === 0) {
            continue;
          }

          logger.debug(
            { stream: config.stream, count: eventsResult.data.length },
            "Read stream events"
          );

          await Promise.allSettled(eventsResult.data.map(handleEvent));
        } catch (error) {
          if (!shouldContinue()) {
            break;
          }

          logger.error(
            { stream: config.stream, error },
            "Error in stream task processing loop"
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      logger.info({ stream: config.stream }, "Stream task stopped");
    },
  };
}
