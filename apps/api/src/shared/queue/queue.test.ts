import { describe, it } from "vitest";

/**
 * Seam: public `queue(def)` API (enqueue / process / ack) — not HTTP.
 * See shared/queue/README.md. Use a test Redis (or injectable client); do not mock internal stream helpers.
 */
describe("queue", () => {
  it.todo(
    "enqueues a payload that the worker process handler receives and acks"
  );

  it.todo(
    "honors delay_until by promoting from the delay ZSET into the stream when due"
  );

  it.todo(
    "on process failure, retries with backoff up to the configured limit"
  );

  it.todo(
    "after retries are exhausted, moves the message to the dead-letter stream"
  );
});
