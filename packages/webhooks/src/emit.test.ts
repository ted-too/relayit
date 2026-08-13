import { describe, expect, test } from "bun:test";
import { webhookDeliverJob } from "./deliver";
import { endpointMatches } from "./emit";

describe("Webhook Endpoint matching", () => {
  test("requires the event type to be allowlisted", () => {
    expect(
      endpointMatches({
        enabled: true,
        eventTypes: [],
        type: "message.sent",
      })
    ).toBe(false);
    expect(
      endpointMatches({
        enabled: true,
        eventTypes: ["message.sent"],
        type: "message.sent",
      })
    ).toBe(true);
  });

  test("excludes paused Endpoints", () => {
    expect(
      endpointMatches({
        enabled: false,
        eventTypes: ["message.sent"],
        type: "message.sent",
      })
    ).toBe(false);
  });

  test("requires every configured Message Tag", () => {
    expect(
      endpointMatches({
        enabled: true,
        eventTypes: ["message.sent"],
        messageTags: { app: "checkout", environment: "production" },
        tagFilter: { app: "checkout", environment: "production" },
        type: "message.sent",
      })
    ).toBe(true);
    expect(
      endpointMatches({
        enabled: true,
        eventTypes: ["message.sent"],
        messageTags: { app: "checkout" },
        tagFilter: { app: "checkout", environment: "production" },
        type: "message.sent",
      })
    ).toBe(false);
  });
});

describe("Webhook Jobs", () => {
  test("uses transactional dispatch", () => {
    expect(webhookDeliverJob.dispatch).toBe("transactional");
  });

  test("keeps HTTP retry policy on the delivery contract", () => {
    expect(webhookDeliverJob.retry).toEqual({
      backoff: {
        baseDelayMs: 30_000,
        maxDelayMs: 60 * 60_000,
      },
      maxAttempts: 8,
    });
  });
});
