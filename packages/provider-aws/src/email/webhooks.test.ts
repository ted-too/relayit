import { describe, expect, it } from "vitest";
import { normalizeSesNotification } from "./webhooks";

const mail = {
  destination: ["recipient@example.com"],
  messageId: "provider-message-id",
};

describe("normalizeSesNotification", () => {
  it("normalizes delivery events", () => {
    expect(
      normalizeSesNotification({
        delivery: { recipients: ["recipient@example.com"] },
        mail,
        notificationType: "Delivery",
      })
    ).toEqual({
      events: [
        {
          kind: "delivered",
          providerMessageId: "provider-message-id",
          raw: {
            delivery: { recipients: ["recipient@example.com"] },
            mail,
            notificationType: "Delivery",
          },
          recipients: ["recipient@example.com"],
          suppress: false,
        },
      ],
      type: "events",
    });
  });

  it("suppresses permanent bounces", () => {
    const result = normalizeSesNotification({
      bounce: {
        bounceType: "Permanent",
        bouncedRecipients: [{ emailAddress: "bad@example.com" }],
      },
      mail,
      notificationType: "Bounce",
    });

    expect(result.type).toBe("events");
    if (result.type === "events") {
      expect(result.events[0]?.kind).toBe("bounced");
      expect(result.events[0]?.recipients).toEqual(["bad@example.com"]);
      expect(result.events[0]?.suppress).toBe(true);
    }
  });

  it("ignores unrelated SES notifications", () => {
    expect(
      normalizeSesNotification({
        mail,
        notificationType: "Received",
      })
    ).toEqual({ type: "noop" });
  });
});
