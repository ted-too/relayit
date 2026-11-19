import { describe, expect, test } from "@effect/vitest";
import { Schema } from "effect";
import {
  campaignSendCompleted,
  contactUpdated,
  deliveryBounced,
  deliverySkipped,
  domainCreated,
  domainUpdated,
  messageScheduled,
  messageSent,
  webhookEventDefinitions,
} from "./index";

const CANONICAL_EVENT_TYPES = [
  "delivery.accepted",
  "delivery.delivered",
  "delivery.delivery_delayed",
  "delivery.bounced",
  "delivery.complained",
  "delivery.opened",
  "delivery.clicked",
  "delivery.skipped",
  "message.sent",
  "message.scheduled",
  "message.failed",
  "campaign_send.completed",
  "domain.created",
  "domain.updated",
  "contact.updated",
];

describe("Webhook Event catalog", () => {
  test("contains every canonical public event type", () => {
    expect(Object.keys(webhookEventDefinitions)).toEqual(CANONICAL_EVENT_TYPES);
  });
});

describe("Delivery Webhook Events", () => {
  test("decodes a provider delivery outcome", () => {
    const payload = Schema.decodeSync(deliveryBounced.payload)({
      delivery_id: "edlv_test",
      kind: "bounced",
      message_id: "msg_test",
      provider_message_id: "provider_test",
      recipients: ["customer@example.com"],
    });

    expect(payload.kind).toBe("bounced");
    expect(payload.recipients).toEqual(["customer@example.com"]);
  });

  test("decodes a policy skip", () => {
    const payload = Schema.decodeSync(deliverySkipped.payload)({
      delivery_id: "edlv_test",
      message_id: "msg_test",
      reason: "suppression",
    });

    expect(payload.reason).toBe("suppression");
  });

  test("decodes a skip for Unsubscribes, and no reason it does not know", () => {
    const decode = Schema.decodeUnknownSync(deliverySkipped.payload);
    const skipped = { delivery_id: "edlv_test", message_id: "msg_test" };

    expect(decode({ ...skipped, reason: "unsubscribed" })).toEqual({
      ...skipped,
      reason: "unsubscribed",
    });
    expect(() => decode({ ...skipped, reason: "paused" })).toThrow();
  });
});

describe("Message Webhook Events", () => {
  test("decodes a scheduled Message payload", () => {
    const payload = Schema.decodeSync(messageScheduled.payload)({
      delivery_id: "edlv_test",
      message_id: "msg_test",
      scheduled_at: "2026-08-09T12:00:00.000Z",
    });

    expect(messageScheduled.type).toBe("message.scheduled");
    expect(payload.message_id).toBe("msg_test");
  });

  test("decodes a sent Message with and without stripped recipients", () => {
    const decode = Schema.decodeUnknownSync(messageSent.payload);
    const sent = {
      delivery_id: "edlv_test",
      message_id: "msg_test",
      provider_message_id: "provider_test",
    };
    const stripped = [
      { email: "bounced@example.com", reason: "suppression" },
      { email: "reader@example.com", reason: "unsubscribed" },
    ];

    // As every `message.sent` was before the field existed.
    expect(decode(sent)).toEqual(sent);
    expect(decode({ ...sent, stripped })).toEqual({ ...sent, stripped });
    expect(() =>
      decode({ ...sent, stripped: [{ email: "bounced@example.com", reason: "paused" }] }),
    ).toThrow();
  });

  test("rejects an incomplete scheduled Message payload", () => {
    expect(() =>
      Schema.decodeUnknownSync(messageScheduled.payload)({
        message_id: "msg_test",
      }),
    ).toThrow();
  });
});

describe("Contact Webhook Events", () => {
  test("decodes each existing contact update source", () => {
    const decode = Schema.decodeSync(contactUpdated.payload);

    const apiPayload = decode({
      contact_id: "cont_test",
      email: "customer@example.com",
      source: "contact.api",
    });
    const messagePayload = decode({
      email: "customer@example.com",
      message_id: "msg_test",
      source: "message.accept",
    });

    if (apiPayload.source !== "contact.api") {
      throw new Error("Expected a contact.api payload");
    }
    if (messagePayload.source !== "message.accept") {
      throw new Error("Expected a message.accept payload");
    }

    expect(apiPayload.contact_id).toBe("cont_test");
    expect(messagePayload.message_id).toBe("msg_test");
  });

  test("rejects source-specific payloads without their stable ID", () => {
    expect(() =>
      Schema.decodeUnknownSync(contactUpdated.payload)({
        email: "customer@example.com",
        source: "contact.api",
      }),
    ).toThrow();
  });
});

describe("Domain Webhook Events", () => {
  test("decodes created and updated payloads", () => {
    expect(
      Schema.decodeSync(domainCreated.payload)({
        domain_id: "domn_test",
        status: "not_verified",
      }).status,
    ).toBe("not_verified");
    expect(
      Schema.decodeSync(domainUpdated.payload)({
        domain_id: "domn_test",
        paused: true,
        paused_reason: "project_sending_pause",
        status: "verified",
      }).status,
    ).toBe("verified");
  });
});

describe("Campaign Send Webhook Events", () => {
  test("decodes the completed status payload", () => {
    const payload = Schema.decodeSync(campaignSendCompleted.payload)({
      campaign_send_id: "csnd_test",
      status: "completed",
    });

    expect(payload.status).toBe("completed");
  });
});
