import { describe, expect, it } from "vitest";
import { assertHardenedPackageJson } from "./package-json";

const DISALLOWED_DEP_RE = /disallowed dependency/;

describe("assertHardenedPackageJson", () => {
  it("accepts registry version specs", () => {
    const result = assertHardenedPackageJson(
      JSON.stringify({
        dependencies: {
          react: "^19.0.0",
          lodash: "4.17.21",
        },
      })
    );
    expect(result.error).toBeNull();
  });

  it("rejects git/http/file dependency specs", () => {
    const result = assertHardenedPackageJson(
      JSON.stringify({
        dependencies: {
          evil: "git+https://example.com/evil.git",
        },
      })
    );
    expect(result.error?.message).toMatch(DISALLOWED_DEP_RE);
  });
});
