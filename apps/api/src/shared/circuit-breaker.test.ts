import { describe, it } from "vitest";

/**
 * Seam: public CircuitBreaker API (allow / recordFailure / recordSuccess / run).
 * Fake Redis at the client boundary; assert state transitions and CircuitOpenError.
 */
describe("CircuitBreaker", () => {
  it.todo("stays closed while consecutive failures are below the threshold");

  it.todo(
    "opens after failureThreshold consecutive failures and rejects with CircuitOpenError"
  );

  it.todo("after cooldownMs, enters half_open and allows a single trial call");

  it.todo("a successful half_open trial closes the circuit");

  it.todo("a failed half_open trial re-opens the circuit for another cooldown");
});
