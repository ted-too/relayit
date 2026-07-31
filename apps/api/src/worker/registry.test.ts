import { describe, it } from "vitest";

/**
 * Seam: worker process registry — which queues/tasks are registered to run.
 * Thin smoke stubs; behavior lives in shared/ queue, tasks, and send handlers.
 */
describe("worker registry", () => {
  it.todo("registers the email send queue(s) expected for Delivery processing");

  it.todo(
    "registers sending-identity verify tasks (ownership, domain, provider identity, sandbox, provider)"
  );

  it.todo("does not register server-only HTTP routes or Better Auth mounts");
});
