import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { RESERVED_PROJECT_SLUGS } from "@repo/contracts/dashboard";
import { describe, expect, it } from "vitest";

describe("the dashboard's root files", () => {
  // A Project's dashboard URL is `/<slug>`, and the image's nginx answers a root file first.
  it("take no name a Project's slug could", () => {
    const publicDir = NodePath.join(import.meta.dirname, "..", "..", "public");
    for (const name of [...NodeFS.readdirSync(publicDir), "config.js", "assets"]) {
      expect(RESERVED_PROJECT_SLUGS.has(name), name).toBe(true);
    }
  });
});
