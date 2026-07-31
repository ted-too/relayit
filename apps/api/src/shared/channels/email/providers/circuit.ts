import { circuitBreaker } from "@repo/api/circuit-breaker";
import * as z from "zod";

/**
 * Trips a provider `open` after repeated send failures so a hard-down provider
 * is skipped across messages until it cools down, rather than being retried on
 * every send. Failover still tries other providers in-run; the queue's backoff
 * retry re-considers a cooled-down provider via the half-open trial.
 */
export const providerCircuitBreaker = circuitBreaker({
  id: "email.provider",
  payload: z.object({ providerId: z.string().min(1) }),
  redis: { member: (p) => [p.providerId] },
  policy: { failureThreshold: 5, cooldownMs: 60_000 },
});
