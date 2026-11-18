import { Data } from "effect";

export class JobEnqueueError extends Data.TaggedError("JobEnqueueError")<{
  readonly cause: unknown;
  readonly jobName: string;
  readonly stage: "append" | "cancel" | "encode" | "outbox" | "schedule";
}> {}

export class JobProcessingError extends Data.TaggedError("JobProcessingError")<{
  readonly cause: unknown;
  readonly entryId: string;
  readonly jobName: string;
  readonly stage:
    | "acknowledge"
    | "dead-letter"
    | "dead-letter-cleanup"
    | "encode-retry"
    | "schedule-retry";
}> {}

export class JobWorkerRuntimeError extends Data.TaggedError("JobWorkerRuntimeError")<{
  readonly cause: unknown;
  readonly stage:
    | "consume"
    | "create-group"
    | "outbox-claim"
    | "outbox-publish"
    | "promote"
    | "reclaim"
    | "reconcile";
  readonly stream?: string;
}> {}

/**
 * A handler died instead of failing: a bug in it or in something it calls. It counts as a
 * failed attempt of its own job, retried and then dead-lettered like any other.
 */
export class JobHandlerDefect extends Data.TaggedError("JobHandlerDefect")<{
  readonly cause: unknown;
}> {}
