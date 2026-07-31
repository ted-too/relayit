/**
 * Generic Redis-streams queue with delay, retry, and dead-letter support.
 *
 * Tasks ({@link task}) compose on the same stream primitives as queues.
 * See `apps/api/src/queue/README.md` for guides and examples.
 *
 * @packageDocumentation
 */

export {
  createProducerStream,
  createWorkerStream,
  type ProducerStream,
  type WorkerStream,
} from "./producer-stream";
export type {
  MaybePromise,
  Queue,
  QueueAttemptFailContext,
  QueueBackoffOptions,
  QueueClient,
  QueueContext,
  QueueDefinition,
  QueueEnqueueOptions,
  QueueHookContext,
  QueueHooks,
  QueueMessageMeta,
  QueueRetryOptions,
  QueueTerminalFailContext,
  QueueWorkerOptions,
} from "./queue";
export {
  DEFAULT_QUEUE_WORKER_OPTIONS,
  QueueTerminalError,
  queue,
} from "./queue";
export type {
  QueueEnvelope,
  StreamConfig,
  StreamMessage,
  StreamPayloadCodec,
} from "./types";
export { payloadFromFields, STREAM_PAYLOAD_FIELD } from "./types";
