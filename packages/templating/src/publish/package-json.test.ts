import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { assertHardenedPackageJson } from "./package-json";

const refused = (pkg: unknown) =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(assertHardenedPackageJson(JSON.stringify(pkg)));
    expect(failure).toMatchObject({ code: "invalid" });
  });

describe("assertHardenedPackageJson", () => {
  it.effect("accepts registry versions, ranges, tags and aliases", () =>
    assertHardenedPackageJson(
      JSON.stringify({
        dependencies: {
          "@react-email/components": "^0.5.3",
          aliased: "npm:@scope/other@~2.1.0",
          any: "*",
          ranged: ">=1.2.0 <2 || 3.x",
          react: "19.2.6",
          tagged: "latest",
        },
        devDependencies: { prerelease: "1.0.0-beta.2+build.5" },
        name: "relayit-email-workspace",
        overrides: { parent: { child: "1.0.1" }, pinned: "2.0.0" },
        type: "module",
      }),
    ),
  );

  // Bun copies a directory dependency into node_modules, where an Entry can import it.
  it.effect.each([
    "..",
    ".",
    " .. ",
    "npm:other@..",
    "../outside",
    "/etc",
    "./vendor/package",
    "~/package",
    "file:../outside",
    "link:../outside",
    "vendored.tgz",
    "user/repo",
    "github:user/repo",
    "git+ssh://git@example.com/user/repo.git",
    "https://example.com/package.tgz",
    "workspace:*",
    "catalog:",
  ])("refuses the dependency spec %s", (spec) => refused({ dependencies: { package: spec } }));

  it.effect.each(["overrides", "resolutions"])(
    "refuses a path in %s, which replaces a dependency's spec",
    (field) =>
      Effect.all([
        refused({ dependencies: { package: "1.0.0" }, [field]: { package: "file:/etc" } }),
        refused({ [field]: { parent: { package: "../outside" } } }),
        refused({ [field]: { package: ".." } }),
      ]),
  );

  it.effect.each(["workspaces", "catalog", "catalogs", "patchedDependencies"])(
    "refuses %s, another way to say where a dependency comes from",
    (field) => refused({ dependencies: { package: "1.0.0" }, [field]: {} }),
  );

  it.effect("refuses dependencies that are not a map of specs", () =>
    Effect.all([
      refused({ dependencies: ["../outside"] }),
      refused({ dependencies: { package: 1 } }),
      refused([]),
    ]),
  );
});
