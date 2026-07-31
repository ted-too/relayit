import { db } from "@repo/api/db";
import { logger } from "@repo/api/utils";
import type { RedisClient } from "bun";
import * as z from "zod";
import { createWorkerStream, type WorkerStream } from "./producer-stream";
import type { QueueEnvelope, StreamConfig, StreamPayloadCodec } from "./types";
import { STREAM_PAYLOAD_FIELD } from "./types";

const DEFAULT_STREAM_BLOCK_TIMEOUT_MS = 5000;

/** Thrown by queue handlers to signal a non-retryable failure (dead-letter). */
export class QueueTerminalError extends Error {
  constructor(
    message: string,
    options?: {
      cause?: unknown;
    }
  ) {
    super(message, options);
    this.name = "QueueTerminalError";
  }
}

export interface QueueBackoffOptions {
  /** Base delay in milliseconds before the first retry. @defaultValue `30000` */
  baseMs?: number;
  /** Maximum backoff delay in milliseconds. @defaultValue `900000` (15 min) */
  maxMs?: number;
}

export interface QueueRetryOptions {
  backoff?: QueueBackoffOptions;
  /** Maximum number of processing attempts (including the first). @defaultValue `3` */
  maxAttempts?: number;
}

export interface QueueWorkerOptions {
  blockTimeoutMs?: number;
  minIdleMs?: number;
  promoteCron: string;
  readCount: number;
}

export const DEFAULT_QUEUE_WORKER_OPTIONS = {
  promoteCron: "*/1 * * * *",
  readCount: 10,
  blockTimeoutMs: DEFAULT_STREAM_BLOCK_TIMEOUT_MS,
  minIdleMs: 60_000,
} satisfies QueueWorkerOptions;

const DEFAULT_QUEUE_RETRY_OPTIONS = {
  maxAttempts: 3,
  backoff: {
    baseMs: 30_000,
    maxMs: 15 * 60_000,
  },
} satisfies Required<QueueRetryOptions>;

export interface QueueContext {
  db: typeof db;
  redis: RedisClient;
}

export interface QueueEnqueueOptions {
  delay_until?: Date | number;
}

export type MaybePromise<T> = T | Promise<T>;

/** Metadata about the stream message being processed. */
export interface QueueMessageMeta {
  /** 1-based attempt number for the current processing run. */
  attempt: number;
  firstEnqueuedAt: number;
  streamId: string;
}

export interface QueueHookContext<Payload> {
  ctx: QueueContext;
  meta: QueueMessageMeta;
  payload: Payload;
}

export interface QueueAttemptFailContext<Payload>
  extends QueueHookContext<Payload> {
  error: unknown;
}

export interface QueueTerminalFailContext<Payload>
  extends QueueHookContext<Payload> {
  error: unknown;
  /** `true` when the handler threw {@link QueueTerminalError}. */
  terminal: boolean;
}

export interface QueueHooks<Payload> {
  /** After a failed attempt that will be retried. Sync or async. */
  onAttemptFail?: (
    hookCtx: QueueAttemptFailContext<Payload>
  ) => MaybePromise<void>;
  /** After `process` completes successfully. Sync or async. */
  onCompleted?: (hookCtx: QueueHookContext<Payload>) => MaybePromise<void>;
  /** When a message is dead-lettered (terminal error or retries exhausted). Sync or async. */
  onTerminalFail?: (
    hookCtx: QueueTerminalFailContext<Payload>
  ) => MaybePromise<void>;
}

export interface QueueClient<Payload> {
  enqueue(
    payload: Payload,
    options?: QueueEnqueueOptions
  ):
    | ReturnType<WorkerStream<QueueEnvelope<Payload>>["enqueue"]>
    | ReturnType<WorkerStream<QueueEnvelope<Payload>>["schedule"]>;
}

export interface Queue<Payload> {
  bootstrap(redis: RedisClient, consumerName: string): Promise<void>;
  readonly deadKey: string;
  readonly delayKey: string;
  readonly group: string;
  readonly id: string;
  run(
    redis: RedisClient,
    consumerName: string,
    shouldContinue: () => boolean
  ): Promise<void>;
  readonly stream: string;
  with(redis: RedisClient): QueueClient<Payload>;
  readonly worker: QueueWorkerOptions;
  workerStream(
    redis: RedisClient,
    consumerName: string
  ): WorkerStream<QueueEnvelope<Payload>>;
}

export interface QueueDefinition<
  PayloadSchema extends z.ZodType,
  Payload = z.infer<PayloadSchema>,
> {
  deadLetter?: boolean;
  hooks?: QueueHooks<Payload>;
  id: string;
  payload: PayloadSchema;
  process(payload: Payload, ctx: QueueContext): Promise<void>;
  retry?: QueueRetryOptions;
  worker?: Partial<QueueWorkerOptions>;
}

function queueKey(id: string, suffix: "stream" | "group" | "delay" | "dead") {
  return `relayit:queue:${id}:${suffix}`;
}

function buildEnvelopeCodec<Payload>(
  payloadSchema: z.ZodType<Payload>
): StreamPayloadCodec<QueueEnvelope<Payload>> {
  const envelopeSchema = z.object({
    data: payloadSchema,
    attempts: z.number().int().min(0),
    firstEnqueuedAt: z.number().int(),
  });

  return z.codec(z.string().min(1), envelopeSchema, {
    encode: (envelope) => JSON.stringify(envelope),
    decode: (wire) => {
      const parsed = JSON.parse(wire) as unknown;
      return envelopeSchema.parse(parsed);
    },
  });
}

function createEnvelope<Payload>(data: Payload): QueueEnvelope<Payload> {
  return {
    data,
    attempts: 0,
    firstEnqueuedAt: Date.now(),
  };
}

function computeBackoffMs(
  attempts: number,
  backoff: Required<QueueBackoffOptions>
): number {
  const exponent = Math.max(0, attempts - 1);
  return Math.min(backoff.baseMs * 2 ** exponent, backoff.maxMs);
}

function isTerminalError(error: unknown): boolean {
  return error instanceof QueueTerminalError;
}

async function invokeHook<T>(
  hook: ((ctx: T) => MaybePromise<void>) | undefined,
  ctx: T,
  {
    hookName,
    stream,
  }: {
    hookName: string;
    stream: string;
  }
) {
  if (!hook) {
    return;
  }

  try {
    await hook(ctx);
  } catch (error) {
    logger.error(
      { stream, hook: hookName, error },
      "Queue lifecycle hook failed"
    );
  }
}

function hookContext<Payload>(
  payload: Payload,
  envelope: QueueEnvelope<Payload>,
  streamId: string,
  ctx: QueueContext
): QueueHookContext<Payload> {
  return {
    payload,
    ctx,
    meta: {
      streamId,
      attempt: envelope.attempts + 1,
      firstEnqueuedAt: envelope.firstEnqueuedAt,
    },
  };
}

/**
 * Define a Redis-streams queue with built-in retry, delay, and dead-letter support.
 */
export function queue<PayloadSchema extends z.ZodType>(
  def: QueueDefinition<PayloadSchema>
): Queue<z.infer<PayloadSchema>> {
  type Payload = z.infer<PayloadSchema>;

  const retryOptions = {
    maxAttempts:
      def.retry?.maxAttempts ?? DEFAULT_QUEUE_RETRY_OPTIONS.maxAttempts,
    backoff: {
      baseMs:
        def.retry?.backoff?.baseMs ??
        DEFAULT_QUEUE_RETRY_OPTIONS.backoff.baseMs,
      maxMs:
        def.retry?.backoff?.maxMs ?? DEFAULT_QUEUE_RETRY_OPTIONS.backoff.maxMs,
    },
  };

  const deadLetterEnabled = def.deadLetter ?? true;

  const config: StreamConfig<QueueEnvelope<Payload>> & {
    group: string;
    scheduleKey: string;
  } = {
    stream: queueKey(def.id, "stream"),
    group: queueKey(def.id, "group"),
    scheduleKey: queueKey(def.id, "delay"),
    codec: buildEnvelopeCodec(def.payload as z.ZodType<Payload>),
  };

  const deadKey = queueKey(def.id, "dead");

  const workerOptions: QueueWorkerOptions = {
    ...DEFAULT_QUEUE_WORKER_OPTIONS,
    ...def.worker,
  };

  const createQueueWorkerStream = (redis: RedisClient, consumer: string) =>
    createWorkerStream(redis, config, consumer);

  async function deadLetter(
    redis: RedisClient,
    envelope: QueueEnvelope<Payload>,
    error: unknown
  ) {
    if (!deadLetterEnabled) {
      return;
    }

    const payload = JSON.stringify({
      ...envelope,
      failedAt: Date.now(),
      error:
        error instanceof Error
          ? { message: error.message, name: error.name }
          : { message: String(error) },
    });

    await redis.send("XADD", [deadKey, "*", STREAM_PAYLOAD_FIELD, payload]);
  }

  return {
    id: def.id,
    stream: config.stream,
    group: config.group,
    delayKey: config.scheduleKey,
    deadKey,
    worker: workerOptions,

    workerStream(redis, consumer) {
      return createQueueWorkerStream(redis, consumer);
    },

    with(redis) {
      const stream = createQueueWorkerStream(redis, "producer");

      return {
        enqueue: (payload: Payload, options?: QueueEnqueueOptions) => {
          const envelope = createEnvelope(payload);
          if (options?.delay_until !== undefined) {
            return stream.schedule(envelope, options.delay_until);
          }
          return stream.enqueue(envelope);
        },
      };
    },

    async bootstrap(redis, consumerName) {
      const workerStream = createQueueWorkerStream(redis, consumerName);
      const groupResult = await workerStream.ensureGroup();

      if (groupResult.error) {
        throw groupResult.error;
      }
    },

    async run(redis, consumerName, shouldContinue) {
      const workerStream = createQueueWorkerStream(redis, consumerName);
      const readCount = workerOptions.readCount;
      const blockTimeoutMs =
        workerOptions.blockTimeoutMs ?? DEFAULT_STREAM_BLOCK_TIMEOUT_MS;
      const minIdleMs = workerOptions.minIdleMs ?? 60_000;

      const handleEvent = async (event: {
        id: string;
        payload: QueueEnvelope<Payload>;
      }) => {
        const envelope = event.payload;
        const baseCtx = { redis, db };
        const startedAt = Date.now();

        logger.debug(
          {
            stream: config.stream,
            streamId: event.id,
            attempt: envelope.attempts + 1,
          },
          "Processing queue event"
        );

        try {
          await def.process(envelope.data, baseCtx);
          logger.debug(
            {
              stream: config.stream,
              streamId: event.id,
              durationMs: Date.now() - startedAt,
            },
            "Processed queue event"
          );
          await invokeHook(
            def.hooks?.onCompleted,
            hookContext(envelope.data, envelope, event.id, baseCtx),
            { hookName: "onCompleted", stream: config.stream }
          );
          const ackResult = await workerStream.ack(event.id);
          if (ackResult.error) {
            logger.error(
              {
                stream: config.stream,
                streamId: event.id,
                error: ackResult.error,
              },
              "Failed to acknowledge queue event"
            );
          }
        } catch (error) {
          const terminal = isTerminalError(error);
          const nextAttempt = envelope.attempts + 1;
          const canRetry = !terminal && nextAttempt < retryOptions.maxAttempts;
          const hookBase = hookContext(
            envelope.data,
            envelope,
            event.id,
            baseCtx
          );

          if (canRetry) {
            await invokeHook(
              def.hooks?.onAttemptFail,
              { ...hookBase, error },
              { hookName: "onAttemptFail", stream: config.stream }
            );

            const retryEnvelope: QueueEnvelope<Payload> = {
              ...envelope,
              attempts: nextAttempt,
            };
            const dueAt =
              Date.now() + computeBackoffMs(nextAttempt, retryOptions.backoff);

            const scheduleResult = await workerStream.schedule(
              retryEnvelope,
              dueAt
            );

            if (scheduleResult.error) {
              logger.error(
                {
                  stream: config.stream,
                  streamId: event.id,
                  attempt: nextAttempt,
                  error: scheduleResult.error,
                },
                "Failed to schedule queue retry"
              );
            }
          } else {
            await invokeHook(
              def.hooks?.onTerminalFail,
              { ...hookBase, error, terminal },
              { hookName: "onTerminalFail", stream: config.stream }
            );
            await deadLetter(redis, envelope, error);
            logger.error(
              {
                stream: config.stream,
                streamId: event.id,
                attempt: envelope.attempts + 1,
                terminal,
                error,
              },
              terminal
                ? "Queue message moved to dead-letter stream"
                : "Queue message exhausted retries, moved to dead-letter stream"
            );
          }

          const ackResult = await workerStream.ack(event.id);
          if (ackResult.error) {
            logger.error(
              {
                stream: config.stream,
                streamId: event.id,
                error: ackResult.error,
              },
              "Failed to acknowledge queue event after failure"
            );
          }
        }
      };

      let lastReclaimAt = 0;

      while (shouldContinue()) {
        try {
          // Adopt messages stranded in a dead consumer's PEL so retries/delivery
          // survive a crashed or removed worker.
          if (Date.now() - lastReclaimAt >= minIdleMs) {
            lastReclaimAt = Date.now();
            const claimResult = await workerStream.claimIdle({
              minIdleMs,
              count: readCount,
            });

            if (claimResult.error) {
              logger.error(
                { stream: config.stream, error: claimResult.error },
                "Failed to reclaim idle queue events"
              );
            } else if (claimResult.data.length > 0) {
              logger.debug(
                { stream: config.stream, count: claimResult.data.length },
                "Reclaimed idle queue events"
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
              "Failed to read queue events"
            );
            await new Promise((resolve) => setTimeout(resolve, 1000));
            continue;
          }

          if (eventsResult.data.length === 0) {
            continue;
          }

          logger.debug(
            { stream: config.stream, count: eventsResult.data.length },
            "Read queue events"
          );

          await Promise.allSettled(eventsResult.data.map(handleEvent));
        } catch (error) {
          if (!shouldContinue()) {
            break;
          }

          logger.error(
            { stream: config.stream, error },
            "Error in queue processing loop"
          );
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }

      logger.info({ stream: config.stream }, "Queue stopped");
    },
  };
}
