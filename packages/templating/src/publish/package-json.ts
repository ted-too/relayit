import { Effect } from "effect";
import { TemplatingBuilderError } from "../rpc/errors";

// A registry version, range or dist-tag, or one of another registry package
// (`npm:name@range`). Anything else Bun takes as somewhere to fetch or copy from, and a
// path is copied from the builder's disk into node_modules, where the bundler may read
// it: `../x`, `/x` and `user/repo` as much as `file:`, `link:`, `git+…` or a URL. No
// version starts with a dot, and `..` alone is the checkout's parent directory.
const REGISTRY_SPEC_RE =
  /^(?:npm:(?:@[a-z0-9._~-]+\/)?[a-z0-9._~-]+@)?(?!\.)[a-z0-9.*^~<>=|+ -]*$/i;
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
// installed. An Email Workspace is one package, so none has a use here.
const REFUSED_FIELDS = ["workspaces", "catalog", "catalogs", "patchedDependencies"];

const isRegistrySpecs = (value: unknown): boolean =>
  typeof value === "string"
    ? REGISTRY_SPEC_RE.test(value.trim()) && !TARBALL_RE.test(value.trim())
    : typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      Object.values(value).every(isRegistrySpecs);

/** Refuse a package.json whose install would take anything from outside the registry. */
export const assertHardenedPackageJson = (raw: string) =>
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
  });
