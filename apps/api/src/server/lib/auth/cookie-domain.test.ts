import { describe, expect, it } from "vitest";
import { sharedCookieDomain } from "./cookie-domain";

describe("sharedCookieDomain", () => {
  it("returns the shared parent for app + api subdomains", () => {
    expect(
      sharedCookieDomain("https://app.relayit.io", "https://api.relayit.io")
    ).toBe("relayit.io");
  });

  it("includes docs on the apex in the shared parent", () => {
    expect(
      sharedCookieDomain(
        "https://app.relayit.io",
        "https://api.relayit.io",
        "https://relayit.io"
      )
    ).toBe("relayit.io");
  });

  it("returns undefined when every hostname matches", () => {
    expect(
      sharedCookieDomain("http://localhost:3000", "http://localhost:3001")
    ).toBeUndefined();
  });

  it("returns undefined when there is no shared parent", () => {
    expect(
      sharedCookieDomain("https://app.relayit.io", "https://api.example.com")
    ).toBeUndefined();
  });

  it("returns undefined for a single url", () => {
    expect(sharedCookieDomain("https://app.relayit.io")).toBeUndefined();
  });
});
