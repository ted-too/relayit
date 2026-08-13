import { describe, expect, test } from "bun:test";
import {
  getCurrentBetterAuthSecret,
  parseBetterAuthSecrets,
} from "./auth-secrets";

describe("parseBetterAuthSecrets", () => {
  test("parses current and previous secrets", () => {
    const config = parseBetterAuthSecrets("2:new-secret,1:old-secret");

    expect(config.currentVersion).toBe(2);
    expect(config.keys.get(2)).toBe("new-secret");
    expect(config.keys.get(1)).toBe("old-secret");
  });

  test("rejects empty input", () => {
    expect(() => parseBetterAuthSecrets("")).toThrow(
      "BETTER_AUTH_SECRETS must include at least one secret"
    );
  });

  test("rejects malformed entries", () => {
    expect(() => parseBetterAuthSecrets("not-versioned")).toThrow(
      'BETTER_AUTH_SECRETS must be "<version>:<secret>[,<version>:<secret>…]"'
    );
  });
});

describe("getCurrentBetterAuthSecret", () => {
  test("returns the first entry secret", () => {
    expect(getCurrentBetterAuthSecret("2:new-secret,1:old-secret")).toBe(
      "new-secret"
    );
  });
});
