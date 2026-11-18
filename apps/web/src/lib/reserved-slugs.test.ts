import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import { ProjectSlug } from "@repo/contracts/dashboard";
import { Schema } from "effect";
import { describe, expect, it } from "vitest";

const isProjectSlug = Schema.is(ProjectSlug);

describe("the dashboard's root paths", () => {
  // A Project's dashboard URL is `/<slug>`, and the image's nginx answers a root file first,
  // so each must be a name `ProjectSlug` refuses: one with a dot, or a reserved one.
  it("take no name a Project's slug could", () => {
    const publicDir = NodePath.join(import.meta.dirname, "..", "..", "public");
    for (const name of [...NodeFS.readdirSync(publicDir), "config.js", "assets"]) {
      expect([name, isProjectSlug(name)]).toEqual([name, false]);
    }
  });

  // The router's file names: `_authd/admin.tsx` is `/admin`, `user.account.tsx` is
  // `/user/account`; `$orgSlug` is the Project itself, and `_`-prefixed files add no path.
  // Each page's first segment must be one `ProjectSlug` refuses.
  it("include every top-level page", () => {
    const routesDir = NodePath.join(import.meta.dirname, "..", "routes");
    const firstSegments = new Set(
      NodeFS.readdirSync(routesDir, { recursive: true })
        .map((file) => String(file).replace(/\.tsx$/, ""))
        .map((file) =>
          file.split(/[/.]/).find((segment) => !segment.startsWith("_") && segment !== "index"),
        )
        .filter((segment): segment is string => segment !== undefined && !segment.startsWith("$")),
    );
    expect(firstSegments.size).toBeGreaterThan(0);
    for (const segment of firstSegments) {
      expect([segment, isProjectSlug(segment)]).toEqual([segment, false]);
    }
  });
});
