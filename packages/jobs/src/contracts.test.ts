import { describe, expect, test } from "bun:test";
import { defineJob, isJobPayloadNone } from "@repo/jobs";
import { Schema } from "effect";

const deliverEmail = defineJob({
  name: "email.deliver",
  payload: Schema.Struct({
    deliveryId: Schema.String,
  }),
  retry: {
    backoff: {
      baseDelayMs: 30_000,
      maxDelayMs: 15 * 60_000,
    },
    maxAttempts: 5,
  },
});

const deliverEmailTransactionally = defineJob({
  dispatch: "transactional",
  name: "email.deliver-transactionally",
  payload: Schema.Struct({
    deliveryId: Schema.String,
  }),
  retry: {
    backoff: {
      baseDelayMs: 30_000,
      maxDelayMs: 15 * 60_000,
    },
    maxAttempts: 5,
  },
});

const verifyDomain = defineJob({
  name: "email.verify-domain",
  payload: Schema.Struct({
    domainId: Schema.String,
  }),
  recurrence: {
    identity: ({ domainId }) => domainId,
  },
  retry: {
    backoff: {
      baseDelayMs: 30_000,
      maxDelayMs: 15 * 60_000,
    },
    maxAttempts: 3,
  },
});

const reconcilePlatform = defineJob({
  name: "email.verify-platform-spf",
  recurrence: {
    identity: () => "platform",
  },
  retry: {
    backoff: {
      baseDelayMs: 30_000,
      maxDelayMs: 15 * 60_000,
    },
    maxAttempts: 3,
  },
});

describe("work contracts", () => {
  test("defines append-only jobs with retry policy", () => {
    expect(deliverEmail.dispatch).toBe("immediate");
    expect(deliverEmail.name).toBe("email.deliver");
    expect(deliverEmail.retry.maxAttempts).toBe(5);
  });

  test("defines transactionally dispatched jobs", () => {
    expect(deliverEmailTransactionally.dispatch).toBe("transactional");
  });

  test("defines identity-managed recurring jobs", () => {
    expect(verifyDomain.name).toBe("email.verify-domain");
    expect(verifyDomain.recurrence.identity({ domainId: "domain_1" })).toBe(
      "domain_1"
    );
  });

  test("omits payload for unit recurring jobs", () => {
    expect(isJobPayloadNone(reconcilePlatform)).toBe(true);
    expect(reconcilePlatform.recurrence.identity(null)).toBe("platform");
  });
});
