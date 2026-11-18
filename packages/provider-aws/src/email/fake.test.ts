import { describe, expect, test } from "bun:test";
import { simulatedSesNotifications } from "./fake";

const outcomes = (to: string[], cc: string[] | null = null) =>
  simulatedSesNotifications("fake-1", { bcc: null, cc, to }).map((event) => ({
    kind: event.kind,
    recipients: event.recipients,
    suppress: event.suppress,
  }));

describe("simulatedSesNotifications", () => {
  test("reports a send and then its delivery, with the bare address as SES does", () => {
    expect(outcomes(["Ada <ada@example.com>"])).toEqual([
      { kind: "accepted", recipients: ["Ada <ada@example.com>"], suppress: false },
      { kind: "delivered", recipients: ["ada@example.com"], suppress: false },
    ]);
  });

  test("hard-bounces the bounce simulator, labels included, and suppresses it", () => {
    expect(
      outcomes(["success@simulator.amazonses.com", "Bounce+x@Simulator.AmazonSES.com"]),
    ).toEqual([
      {
        kind: "accepted",
        recipients: ["success@simulator.amazonses.com", "Bounce+x@Simulator.AmazonSES.com"],
        suppress: false,
      },
      { kind: "delivered", recipients: ["success@simulator.amazonses.com"], suppress: false },
      { kind: "bounced", recipients: ["Bounce+x@Simulator.AmazonSES.com"], suppress: true },
    ]);
  });

  test("delivers to the complaint simulator, then reports its complaint", () => {
    expect(outcomes(["a@example.com"], ["complaint@simulator.amazonses.com"])).toEqual([
      {
        kind: "accepted",
        recipients: ["a@example.com", "complaint@simulator.amazonses.com"],
        suppress: false,
      },
      {
        kind: "delivered",
        recipients: ["a@example.com", "complaint@simulator.amazonses.com"],
        suppress: false,
      },
      { kind: "complained", recipients: ["complaint@simulator.amazonses.com"], suppress: true },
    ]);
  });
});
