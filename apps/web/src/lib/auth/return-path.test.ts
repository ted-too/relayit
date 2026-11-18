import { describe, expect, it } from "vitest";
import { returnPath } from "./return-path";

const ORIGIN = "https://app.relayit.test";

describe("returnPath", () => {
  it("keeps the path, query and hash of a path on this origin", () => {
    expect(returnPath("/acme/domains?status=failed#records", ORIGIN)).toBe(
      "/acme/domains?status=failed#records",
    );
    expect(returnPath("acme", ORIGIN)).toBe("/acme");
    expect(returnPath(`${ORIGIN}/acme?tab=keys`, ORIGIN)).toBe("/acme?tab=keys");
  });

  it("goes home for nothing, or for anywhere off this origin", () => {
    for (const redirect of [
      undefined,
      "",
      "https://other.test/acme",
      "//other.test/acme",
      "/\\other.test/acme",
      "/.//other.test/acme",
      "/./\\other.test/acme",
      `${ORIGIN}//other.test/acme`,
      "javascript:alert(1)",
    ]) {
      expect([redirect, returnPath(redirect, ORIGIN)]).toEqual([redirect, "/"]);
    }
  });
});
