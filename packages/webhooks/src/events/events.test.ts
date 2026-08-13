import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  campaignSendCompleted,
  contactUpdated,
  deliveryBounced,
  deliverySkipped,
  domainCreated,
  domainUpdated,
  messageScheduled,
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

  test("rejects an incomplete scheduled Message payload", () => {
    expect(() =>
      Schema.decodeUnknownSync(messageScheduled.payload)({
        message_id: "msg_test",
      })
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
      })
    ).toThrow();
  });
});

describe("Domain Webhook Events", () => {
  test("decodes minimal created and updated payloads", () => {
    expect(
      Schema.decodeSync(domainCreated.payload)({
        domain_id: "domn_test",
        status: "not_verified",
      }).status
    ).toBe("not_verified");
    expect(
      Schema.decodeSync(domainUpdated.payload)({
        domain_id: "domn_test",
        status: "verified",
      }).status
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
