import { webhookDeliverQueue } from "@repo/api/messages/webhooks";
import type { Queue } from "@repo/api/queue";
import { emailSendQueue } from "@repo/api/send";

/**
 * Stream-backed queues the worker consumes. Unlike {@link WORKER_TASKS} these
 * carry an arbitrary payload envelope (with retry/dead-letter semantics) rather
 * than a reconcilable, DB-derived schedule.
 */
export const WORKER_QUEUES = [
  emailSendQueue.delivery,
  webhookDeliverQueue.http,
] satisfies Queue<unknown>[];
