import { describe, expect, test } from "bun:test";
import { generateWebhookSigningSecret, signWebhookPayload } from "./signing";

const WEBHOOK_SECRET_PATTERN = /^whsec_[A-Za-z0-9_-]{43}$/;

const payload = {
  idempotencyId: "evt_01JXYZ",
  timestamp: 1_723_000_000,
  body: '{"message":"hello"}',
};

describe("webhook signing", () => {
  test("generates prefixed signing secrets", () => {
    const first = generateWebhookSigningSecret();
    const second = generateWebhookSigningSecret();

    expect(first).toMatch(WEBHOOK_SECRET_PATTERN);
    expect(second).toMatch(WEBHOOK_SECRET_PATTERN);
    expect(first).not.toBe(second);
  });

  test("signs the stable id.timestamp.body input with HMAC-SHA256", () => {
    expect(
      signWebhookPayload({
        secret: "whsec_test_secret",
        ...payload,
      })
    ).toBe(
      "v1=6615bc31b9ec76bc3801fdde47d2d742a15cd5edcd1a2b05a0b6410cf3a26ac3"
    );
  });
});
