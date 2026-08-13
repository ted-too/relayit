import { describe, expect, test } from "bun:test";
import { mergeMessageContacts, normalizeContactEmail } from "./contacts";

describe("Message acceptance Contacts", () => {
  test("normalizes Contact email addresses", () => {
    expect(normalizeContactEmail("  ADA@Example.COM ")).toBe("ada@example.com");
  });

  test("merges duplicate recipients without replacing earlier fields", () => {
    expect(
      mergeMessageContacts([
        {
          email: "Ada@example.com",
          firstName: "Ada",
          properties: { plan: "pro", source: "to" },
        },
        {
          email: "ada@EXAMPLE.com",
          lastName: "Lovelace",
          properties: { plan: "free", region: "uk" },
        },
      ])
    ).toEqual([
      {
        email: "ada@example.com",
        firstName: "Ada",
        lastName: "Lovelace",
        properties: {
          plan: "pro",
          region: "uk",
          source: "to",
        },
      },
    ]);
  });
});
