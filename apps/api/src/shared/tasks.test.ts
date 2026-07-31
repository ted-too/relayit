import { describe, it } from "vitest";

/**
 * Seam: public `task(def)` API (schedule / unschedule / reconcile) — not HTTP.
 * Distinct from queue: deduplicated scheduling via redis.member.
 */
describe("task", () => {
  it.todo(
    "schedule is deduplicated by redis.member — the same logical job appears once"
  );

  it.todo("unschedule removes the pending member so it is not run");

  it.todo(
    "optional reconcile repairs the schedule from DB when the in-memory/Redis view drifts"
  );

  it.todo(
    "handler errors are logged and acked (no queue-style retry / dead-letter)"
  );
});
