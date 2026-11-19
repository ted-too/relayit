import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { Effect } from "effect";
import { TemplatingBuilderError } from "../rpc/errors";

// A registry version, range or dist-tag, or one of another registry package
// (`npm:name@range`). Anything else Bun takes as somewhere to fetch or copy from, and a
// path is copied from the builder's disk into node_modules, where the bundler may read
// it: `../x`, `/x` and `user/repo` as much as `file:`, `link:`, `git+…` or a URL. No
// version starts with a dot, and `..` alone is the checkout's parent directory. `npm:` is
// matched as written: in any other case Bun reads it as a git host.
const REGISTRY_SPEC_RE =
  /^(?:npm:(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+@)?(?!\.)[a-zA-Z0-9.*^~<>=|+ -]*$/;
// Allowed by the pattern above, and read as a tarball beside package.json.
const TARBALL_RE = /\.(?:tgz|tar|tar\.gz)$/i;

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
  // These replace a dependency's spec, at any depth of nesting.
  "overrides",
  "resolutions",
];

// Each is another way to name where a dependency comes from, or to rewrite one once it is
// installed. An Email Workspace is one package, so none has a use here. Refused by name
// so the Project is told; any other field Bun's install honours is dropped below.
const REFUSED_FIELDS = [
  "workspaces",
  "catalog",
  "catalogs",
  "patchedDependencies",
  "packageExtensions",
];

// What the install and the bundler's resolver need of a workspace's package.json. The
// install is given these and nothing else.
const KEPT_FIELDS = new Set([
  ...DEPENDENCY_FIELDS,
  "name",
  "version",
  "private",
  "type",
  "peerDependenciesMeta",
  "main",
  "module",
  "browser",
  "exports",
  "imports",
  "sideEffects",
]);

const isRegistrySpecs = (value: unknown): boolean =>
  typeof value === "string"
    ? REGISTRY_SPEC_RE.test(value.trim()) && !TARBALL_RE.test(value.trim())
    : typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.values(value).every(isRegistrySpecs);

/**
 * Refuse a package.json whose install would take anything from outside the registry, and
 * answer the package.json to install from: the checked fields, written out again.
 *
 * The text a Project committed is never what Bun reads. Bun's reader and `JSON.parse`
 * disagree about it (of two keys with one name Bun takes the first and `JSON.parse` the
 * last), so a check of the text checks a different manifest from the one installed.
 */
export const hardenPackageJson = (raw: string) =>
  Effect.gen(function* () {
    const pkg = yield* Effect.try({
      catch: () =>
        new TemplatingBuilderError({
          code: "invalid",
          message: "package.json is not valid JSON.",
        }),
      try: () => JSON.parse(raw) as unknown,
    });

    if (
      typeof pkg !== "object" ||
      pkg === null ||
      Array.isArray(pkg) ||
      REFUSED_FIELDS.some((field) => field in pkg) ||
      DEPENDENCY_FIELDS.some(
        (field) =>
          field in pkg &&
          !(
            typeof (pkg as Record<string, unknown>)[field] === "object" &&
            isRegistrySpecs((pkg as Record<string, unknown>)[field])
          ),
      )
    ) {
      return yield* new TemplatingBuilderError({
        code: "invalid",
        message: "package.json has disallowed dependency specs (registry versions only).",
      });
    }

    return `${JSON.stringify(
      Object.fromEntries(Object.entries(pkg).filter(([field]) => KEPT_FIELDS.has(field))),
      null,
      2,
    )}\n`;
  });

/** Replace a checkout's package.json with its hardened one, before anything installs from it. */
export const hardenCheckedOutPackageJson = (workspaceDir: string) =>
  Effect.gen(function* () {
    const path = NodePath.join(workspaceDir, "package.json");
    const raw = yield* Effect.tryPromise({
      catch: () =>
        new TemplatingBuilderError({
          code: "failed",
          message: "Failed to read package.json.",
        }),
      try: () => NodeFSP.readFile(path, "utf8"),
    });
    const hardened = yield* hardenPackageJson(raw);
    yield* Effect.tryPromise({
      catch: () =>
        new TemplatingBuilderError({
          code: "failed",
          message: "Failed to write package.json.",
        }),
      try: () => NodeFSP.writeFile(path, hardened),
    });
  });
