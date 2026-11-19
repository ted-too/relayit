import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { hardenPackageJson } from "./package-json";

const refused = (pkg: unknown) =>
  Effect.gen(function* () {
    const failure = yield* Effect.flip(hardenPackageJson(JSON.stringify(pkg)));
    expect(failure).toMatchObject({ code: "invalid" });
  });

describe("hardenPackageJson", () => {
  it.effect("accepts registry versions, ranges, tags and aliases", () =>
    hardenPackageJson(
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
    // In capitals Bun reads the alias prefix as a git host.
    "NPM:other@1.0.0",
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

  it.effect.each(["workspaces", "catalog", "catalogs", "patchedDependencies", "packageExtensions"])(
    "refuses %s, another way to say where a dependency comes from",
    (field) => refused({ dependencies: { package: "1.0.0" }, [field]: {} }),
  );

  it.effect("refuses dependencies that are not a map of specs", () =>
    Effect.all([
      refused({ dependencies: ["../outside"] }),
      refused({ dependencies: { package: 1 } }),
      // Only an override nests.
      refused({ dependencies: { package: { nested: "1.0.0" } } }),
      refused([]),
    ]),
  );

  // Of two keys with one name Bun installs from the first and JSON.parse reads the last,
  // so the text is never what is installed: the answer is, and it holds one of them.
  it.effect.each([
    '{ "dependencies": { "host": "../outside" }, "dependencies": { "react": "19.2.6" } }',
    '{ "dependenci\\u0065s": { "host": "../outside" }, "dependencies": { "react": "19.2.6" } }',
    '{ "dependencies": { "react": "../outside", "react": "19.2.6" } }',
  ])("answers a package.json with one reading of %s", (raw) =>
    Effect.gen(function* () {
      const hardened = yield* hardenPackageJson(raw);

      expect(hardened).not.toContain("outside");
      expect(hardened.match(/"dependencies"/g)).toHaveLength(1);
      expect(JSON.parse(hardened)).toEqual({ dependencies: { react: "19.2.6" } });
    }),
  );

  it.effect("answers only the fields an install and the bundler's resolver need", () =>
    Effect.gen(function* () {
      const hardened = yield* hardenPackageJson(
        JSON.stringify({
          dependencies: { react: "19.2.6" },
          imports: { "#lib/*": "./lib/*" },
          name: "relayit-email-workspace",
          scripts: { postinstall: "curl example.com" },
          trustedDependencies: ["react"],
          type: "module",
          unknownToUs: { "is-number": "https://example.com/package.tgz" },
        }),
      );

      expect(JSON.parse(hardened)).toEqual({
        dependencies: { react: "19.2.6" },
        imports: { "#lib/*": "./lib/*" },
        name: "relayit-email-workspace",
        type: "module",
      });
    }),
  );

  it.effect(
    "refuses overrides nested deeper than any are, where a walk would run out of stack",
    () =>
      hardenPackageJson(
        `{ "overrides": ${'{ "a": '.repeat(200_000)}"1.0.0"${"}".repeat(200_000)} }`,
      ).pipe(
        Effect.flip,
        Effect.map((failure) => expect(failure).toMatchObject({ code: "invalid" })),
      ),
  );
});
