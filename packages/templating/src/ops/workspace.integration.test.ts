/**
 * The builder's workspace operations against a real Postgres and Redis, with objects in a
 * temp directory. `bun install` runs for real, so these need the npm registry.
 */
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { describe, expect, it, test } from "@effect/vitest";
import { makeLocalObjectStorageLive, ObjectStorage } from "@repo/object-storage";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import { organization, templatingWorkspace } from "@repo/persistence/db/schema";
import { makeRedisLive, Redis } from "@repo/redis";
import { renderSealedReactEmailArtifact } from "@repo/template-render/react-email";
import { Deferred, Effect, Fiber, Layer } from "effect";
import { typeid } from "typeid-js";
import { commitFiles as gitCommitFiles, HOSTED_DEV_REF, withWorkspaceGitLock } from "../git";
import { commitFiles, depsSync, listFiles, preview, publish, readFile } from "./workspace";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testRedisUrl = Bun.env.TEST_REDIS_URL;

// A hook is what tells one React from two: it reads the dispatcher the renderer set on its
// own copy, and finds none on another.
const HOOKED_ENTRY = `import * as React from "react";
import { Html, Body, Text } from "@react-email/components";

export default function HookedEmail({ name }: { name: string }) {
  const id = React.useId();
  return (
    <Html>
      <Body>
        <Text id={id}>Hello, {name}!</Text>
      </Body>
    </Html>
  );
}
`;

const COMPOSED_ENTRY = `import { Html, Body, Text } from "@react-email/components";
import copy from "../lib/copy.json";
import { greeting } from "../lib/greeting";

export default function ComposedEmail({ name }: { name: string }) {
  return (
    <Html>
      <Body>
        <Text>{greeting(name)}</Text>
        <Text>{copy.signoff}</Text>
      </Body>
    </Html>
  );
}
`;

const THROWING_ENTRY = `export default function BrokenEmail() {
  throw new Error("no such order");
}
`;

const SYNTAX_ERROR_ENTRY = `export default function UnclosedEmail() {
  return <div>;
}
`;

// Names a package the starter lockfile does not have.
const UNINSTALLABLE_PACKAGE_JSON = `{
  "name": "relayit-email-workspace",
  "private": true,
  "type": "module",
  "dependencies": {
    "@react-email/components": "^0.5.3",
    "is-number": "7.0.0",
    "react": "^19.2.6",
    "react-dom": "^19.2.6"
  }
}
`;

describe("workspace operations (PostgreSQL, Redis)", () => {
  if (!(testDatabaseUrl && testRedisUrl)) {
    process.emitWarning("Skipping workspace tests: TEST_DATABASE_URL or TEST_REDIS_URL unset");
    // The PostgreSQL and Redis test is opt-in.
    test.skip("workspace operations", () => undefined);
    return;
  }

  const services = Layer.mergeAll(
    makeDbLive({ databaseUrl: testDatabaseUrl }),
    makeRedisLive({ keyPrefix: `test:${Bun.randomUUIDv7()}:`, url: testRedisUrl }),
    Layer.unwrap(
      Effect.map(
        Effect.acquireRelease(
          Effect.promise(() =>
            NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "relayit-workspace-test-")),
          ),
          (dir) => Effect.promise(() => NodeFSP.rm(dir, { force: true, recursive: true })),
        ),
        makeLocalObjectStorageLive,
      ),
    ),
  );

  /** A new Project's workspace row, as the api makes it on first open: no Git yet. */
  const insertWorkspace = Effect.gen(function* () {
    const db = yield* DB;
    const organizationId = typeid("orgn").toString();
    yield* db
      .insert(organization)
      .values({ id: organizationId, name: "Workspace", slug: `workspace-${organizationId}` });
    const [workspace] = yield* db
      .insert(templatingWorkspace)
      .values({ kind: "reactEmail", organizationId, source: "hosted", updatedAt: new Date() })
      .returning();
    if (!workspace) {
      return yield* Effect.die("no workspace row");
    }
    return workspace.id;
  });

  /** A directory of the host's, beside the checkouts and outside every one of them. */
  const hostDirectory = Effect.acquireRelease(
    Effect.promise(() => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "relayit-host-file-"))),
    (dir) => Effect.promise(() => NodeFSP.rm(dir, { force: true, recursive: true })),
  );

  it.live(
    "answers every first read of a new workspace, though only one of them scaffolds it",
    () =>
      Effect.gen(function* () {
        const workspaceId = yield* insertWorkspace;

        const reads = yield* Effect.all(
          [listFiles({ workspaceId }), listFiles({ workspaceId }), listFiles({ workspaceId })],
          { concurrency: "unbounded" },
        );

        const [first] = reads;
        expect(first?.paths).toEqual(["bun.lock", "package.json", "reactEmail/welcome.tsx"]);
        // One scaffold commit, seen by all: a second would have moved the tip.
        expect(reads.map((read) => read.commitSha)).toEqual(reads.map(() => first?.commitSha));
      }).pipe(Effect.provide(services)),
    120_000,
  );

  it.live("refuses a waiting caller as busy once its wait runs out", () =>
    Effect.gen(function* () {
      const workspaceId = typeid("twsp").toString();

      const waited = yield* withWorkspaceGitLock(
        workspaceId,
        Effect.flip(withWorkspaceGitLock(workspaceId, Effect.void, { waitFor: "300 millis" })),
      );

      expect(waited).toMatchObject({ code: "busy" });
    }).pipe(Effect.provide(services)),
  );

  it.live("frees the lock of a caller interrupted while Redis was taking it", () =>
    Effect.gen(function* () {
      const workspaceId = typeid("twsp").toString();
      const redis = yield* Redis;
      const taken = yield* Deferred.make<void>();

      // Redis sets the key, then its answer is slow to arrive.
      const holder = yield* withWorkspaceGitLock(workspaceId, Effect.never).pipe(
        Effect.provideService(Redis, {
          ...redis,
          evaluateNumber: (input) =>
            redis.evaluateNumber(input).pipe(
              Effect.tap(() => Deferred.succeed(taken, undefined)),
              Effect.tap(() => Effect.promise(() => Bun.sleep(200))),
            ),
        }),
        Effect.forkChild,
      );
      yield* Deferred.await(taken);
      yield* Fiber.interrupt(holder);

      // A take that does not wait, as a write's: refused as busy unless the lock is free.
      expect(yield* withWorkspaceGitLock(workspaceId, Effect.succeed("free"))).toBe("free");
    }).pipe(Effect.provide(services)),
  );

  it.live("refuses a write at once while the lock is held, without the read's wait", () =>
    Effect.gen(function* () {
      const workspaceId = typeid("twsp").toString();

      const refused = yield* withWorkspaceGitLock(
        workspaceId,
        commitFiles({ changes: { "reactEmail/a.tsx": "" }, workspaceId }).pipe(
          Effect.flip,
          // Far under the 30 seconds a first read waits.
          Effect.timeout("5 seconds"),
        ),
      );

      expect(refused).toMatchObject({ code: "busy" });
    }).pipe(Effect.provide(services)),
  );

  it.live(
    "renders a published Entry that uses a hook, on send and in preview",
    () =>
      Effect.gen(function* () {
        const workspaceId = yield* insertWorkspace;
        yield* commitFiles({ changes: { "reactEmail/hooked.tsx": HOOKED_ENTRY }, workspaceId });

        yield* publish({ workspaceId });
        const db = yield* DB;
        const entry = yield* db.query.templatingWorkspaceEntry.findFirst({
          where: { path: "reactEmail/hooked.tsx", workspaceId },
        });
        const storage = yield* ObjectStorage;
        const artifact = yield* storage.download(entry?.artifactStorageKey ?? "");
        const sent = yield* Effect.promise(() =>
          renderSealedReactEmailArtifact({
            artifact: artifact.body,
            props: { name: "Ada" },
            subject: "Hi",
          }),
        );
        expect(sent).toMatchObject({ ok: true, value: { text: "Hello, Ada!" } });

        const previewed = yield* preview({
          entryId: entry?.id ?? "",
          props: { name: "Grace" },
          subjectOverride: "Hi",
          workspaceId,
        });
        expect(previewed.text).toBe("Hello, Grace!");
      }).pipe(Effect.provide(services)),
    120_000,
  );

  it.live(
    "says why a preview's render failed",
    () =>
      Effect.gen(function* () {
        const workspaceId = yield* insertWorkspace;
        yield* commitFiles({ changes: { "reactEmail/broken.tsx": THROWING_ENTRY }, workspaceId });
        const db = yield* DB;
        const entry = yield* db.query.templatingWorkspaceEntry.findFirst({
          where: { path: "reactEmail/broken.tsx", workspaceId },
        });

        const failure = yield* Effect.flip(
          preview({ entryId: entry?.id ?? "", subjectOverride: "Hi", workspaceId }),
        );

        expect(failure).toMatchObject({
          code: "failed",
          detail: "no such order",
          message: "Preview render failed.",
        });
      }).pipe(Effect.provide(services)),
    120_000,
  );

  it.live(
    "says where an Entry's syntax error is when its preview fails to bundle",
    () =>
      Effect.gen(function* () {
        const workspaceId = yield* insertWorkspace;
        yield* commitFiles({
          changes: { "reactEmail/unclosed.tsx": SYNTAX_ERROR_ENTRY },
          workspaceId,
        });
        const db = yield* DB;
        const entry = yield* db.query.templatingWorkspaceEntry.findFirst({
          where: { path: "reactEmail/unclosed.tsx", workspaceId },
        });

        const failure = yield* Effect.flip(
          preview({ entryId: entry?.id ?? "", subjectOverride: "Hi", workspaceId }),
        );

        // The bundler's message, at the Entry's own path: nothing of the checkout's
        // temp directory, which is the host's.
        expect(failure).toMatchObject({
          code: "failed",
          message: "Failed to bundle workspace entry.",
        });
        expect(failure.detail).toMatch(/^reactEmail\/unclosed\.tsx:2:\d+: /);
        expect(failure.detail).toContain("  return <div>;");
        expect(failure.detail).not.toContain(NodeOS.tmpdir());
        expect(failure.detail).not.toContain("relayit-preview-");
      }).pipe(Effect.provide(services)),
    120_000,
  );

  it.live(
    "builds an Entry that imports the workspace's own files, in preview and on Publish",
    () =>
      Effect.gen(function* () {
        const workspaceId = yield* insertWorkspace;
        yield* commitFiles({
          changes: {
            "lib/copy.json": '{ "signoff": "The team" }\n',
            "lib/greeting.ts": "export const greeting = (name: string) => `Hello, ${name}!`;\n",
            "reactEmail/composed.tsx": COMPOSED_ENTRY,
          },
          workspaceId,
        });
        const db = yield* DB;
        const entry = yield* db.query.templatingWorkspaceEntry.findFirst({
          where: { path: "reactEmail/composed.tsx", workspaceId },
        });

        const previewed = yield* preview({
          entryId: entry?.id ?? "",
          props: { name: "Grace" },
          subjectOverride: "Hi",
          workspaceId,
        });
        expect(previewed.text).toBe("Hello, Grace!\n\nThe team");

        const published = yield* publish({ workspaceId });
        expect(published.entries).toContainEqual({
          id: entry?.id,
          path: "reactEmail/composed.tsx",
          pickable: true,
        });
      }).pipe(Effect.provide(services)),
    120_000,
  );

  it.live(
    "does not run an Entry's bundle-time macro, in preview or on Publish",
    () =>
      Effect.gen(function* () {
        const outside = yield* hostDirectory;
        const ran = NodePath.join(outside, "macro-ran");
        process.env.RELAYIT_TEST_BUILDER_SECRET = "from-the-builder";
        yield* Effect.addFinalizer(() =>
          Effect.sync(() => {
            delete process.env.RELAYIT_TEST_BUILDER_SECRET;
          }),
        );
        const workspaceId = yield* insertWorkspace;
        yield* commitFiles({
          changes: {
            // A macro's return value is inlined into the artifact, and its body runs
            // wherever the bundler does.
            "lib/secret.ts": `import { writeFileSync } from "node:fs";\nexport function secret() {\n  writeFileSync(${JSON.stringify(ran)}, "ran");\n  return process.env.RELAYIT_TEST_BUILDER_SECRET ?? "unset";\n}\n`,
            "reactEmail/macro.tsx": `import { secret } from "../lib/secret.ts" with { type: "macro" };\nexport default function MacroEmail() {\n  return <div>{secret()}</div>;\n}\n`,
          },
          workspaceId,
        });
        const db = yield* DB;
        const entry = yield* db.query.templatingWorkspaceEntry.findFirst({
          where: { path: "reactEmail/macro.tsx", workspaceId },
        });

        const failure = yield* Effect.flip(
          preview({ entryId: entry?.id ?? "", subjectOverride: "Hi", workspaceId }),
        );
        expect(failure).toMatchObject({
          code: "failed",
          message: "Failed to bundle workspace entry.",
        });
        expect(failure.detail).toMatch(/^reactEmail\/macro\.tsx:3:\d+: Macros are disabled\n/);
        expect(failure.detail).not.toContain("from-the-builder");

        const unpublished = yield* Effect.flip(publish({ workspaceId }));
        expect(unpublished.message).toBe("Failed to bundle workspace entry.");
        const sealed = yield* db.query.templatingWorkspaceEntry.findFirst({
          where: { path: "reactEmail/macro.tsx", workspaceId },
        });
        expect(sealed?.artifactStorageKey).toBeNull();

        expect(yield* Effect.promise(() => NodeFSP.exists(ran))).toBe(false);
      }).pipe(Effect.scoped, Effect.provide(services)),
    120_000,
  );

  it.live.each([
    { how: "an absolute path", specifier: (hostFile: string) => hostFile },
    {
      // Every checkout is a directory of the same temp directory the host file is under.
      how: "a path that climbs out with ..",
      specifier: (hostFile: string) =>
        `../../${NodePath.basename(NodePath.dirname(hostFile))}/${NodePath.basename(hostFile)}`,
    },
  ])(
    "keeps a host file an Entry imports as text by $how out of preview and Publish",
    ({ specifier }) =>
      Effect.gen(function* () {
        const outside = yield* hostDirectory;
        const hostFile = NodePath.join(outside, "environ");
        yield* Effect.promise(() => NodeFSP.writeFile(hostFile, "DATABASE_URL=from-the-host\n"));
        const workspaceId = yield* insertWorkspace;
        yield* commitFiles({
          changes: {
            "reactEmail/reaching.tsx": `import environ from ${JSON.stringify(specifier(hostFile))} with { type: "text" };\nexport default function ReachingEmail() {\n  return <div>{environ}</div>;\n}\n`,
          },
          workspaceId,
        });
        const db = yield* DB;
        const entry = yield* db.query.templatingWorkspaceEntry.findFirst({
          where: { path: "reactEmail/reaching.tsx", workspaceId },
        });

        const failure = yield* Effect.flip(
          preview({ entryId: entry?.id ?? "", subjectOverride: "Hi", workspaceId }),
        );
        expect(failure).toMatchObject({
          code: "failed",
          detail: "reactEmail/reaching.tsx: An import reaches outside the workspace.",
          message: "Failed to bundle workspace entry.",
        });

        const unpublished = yield* Effect.flip(publish({ workspaceId }));
        expect(unpublished.message).toBe("Failed to bundle workspace entry.");
        const sealed = yield* db.query.templatingWorkspaceEntry.findFirst({
          where: { path: "reactEmail/reaching.tsx", workspaceId },
        });
        expect(sealed?.artifactStorageKey).toBeNull();
      }).pipe(Effect.scoped, Effect.provide(services)),
    120_000,
  );

  it.live(
    "installs from the package.json it checked, not from the text a commit wrote",
    () =>
      Effect.gen(function* () {
        const outside = yield* hostDirectory;
        yield* Effect.promise(() =>
          Promise.all([
            NodeFSP.writeFile(NodePath.join(outside, "package.json"), '{ "name": "host" }\n'),
            NodeFSP.writeFile(NodePath.join(outside, "environ"), "DATABASE_URL=from-the-host\n"),
          ]),
        );
        const workspaceId = yield* insertWorkspace;
        // Bun installs from the first `dependencies` of two, and the check reads the last.
        yield* commitFiles({
          changes: {
            "package.json": `{\n  "dependencies": { "host": ${JSON.stringify(outside)} },\n  "name": "relayit-email-workspace",\n  "type": "module",\n  "dependencies": { "@react-email/components": "^0.5.3", "react": "^19.2.6", "react-dom": "^19.2.6" }\n}\n`,
            "reactEmail/reaching.tsx": `import environ from "host/environ" with { type: "text" };\nexport default function ReachingEmail() {\n  return <div>{environ}</div>;\n}\n`,
          },
          workspaceId,
        });
        const db = yield* DB;
        const entry = yield* db.query.templatingWorkspaceEntry.findFirst({
          where: { path: "reactEmail/reaching.tsx", workspaceId },
        });

        yield* depsSync({ workspaceId });
        const lockfile = yield* readFile({ path: "bun.lock", workspaceId });
        expect(lockfile.content).not.toContain("host");

        const failure = yield* Effect.flip(
          preview({ entryId: entry?.id ?? "", subjectOverride: "Hi", workspaceId }),
        );
        expect(failure).toMatchObject({ message: "Failed to bundle workspace entry." });
        expect(failure.detail).toContain('Could not resolve: "host/environ"');
      }).pipe(Effect.scoped, Effect.provide(services)),
    120_000,
  );

  it.live.each([".npmrc", "bunfig.toml", "reactEmail/.npmrc", "package-lock.json"])(
    "refuses %s in a workspace, at a commit and in a tree that already holds one",
    (path) =>
      Effect.gen(function* () {
        const workspaceId = yield* insertWorkspace;
        yield* listFiles({ workspaceId });
        const db = yield* DB;
        const entry = yield* db.query.templatingWorkspaceEntry.findFirst({
          where: { path: "reactEmail/welcome.tsx", workspaceId },
        });

        const refused = yield* Effect.flip(
          commitFiles({ changes: { [path]: "registry=http://127.0.0.1:9/\n" }, workspaceId }),
        );
        expect(refused).toMatchObject({
          code: "invalid",
          message:
            "A workspace cannot hold .npmrc, bunfig.toml or another package manager's lockfile.",
        });

        // As a commit made before the refusal left it.
        yield* withWorkspaceGitLock(
          workspaceId,
          gitCommitFiles({
            changes: { [path]: "registry=http://127.0.0.1:9/\n" },
            message: "chore: name a registry",
            ref: HOSTED_DEV_REF,
            workspaceId,
          }),
        );
        const failure = yield* Effect.flip(
          preview({ entryId: entry?.id ?? "", subjectOverride: "Hi", workspaceId }),
        );
        expect(failure).toMatchObject({
          code: "invalid",
          detail: `Delete ${path} from the workspace.`,
          message:
            "A workspace cannot hold .npmrc, bunfig.toml or another package manager's lockfile.",
        });
        expect(yield* Effect.flip(publish({ workspaceId }))).toMatchObject({ code: "invalid" });
        expect(yield* Effect.flip(depsSync({ workspaceId }))).toMatchObject({ code: "invalid" });

        yield* commitFiles({ changes: { [path]: null }, workspaceId });
        const previewed = yield* preview({
          entryId: entry?.id ?? "",
          props: { name: "Ada" },
          subjectOverride: "Hi",
          workspaceId,
        });
        expect(previewed.text).toBe("Welcome, Ada!");
      }).pipe(Effect.provide(services)),
    120_000,
  );

  it.live(
    "gives the install's stderr when a preview's install fails",
    () =>
      Effect.gen(function* () {
        const workspaceId = yield* insertWorkspace;
        yield* listFiles({ workspaceId });
        // The manifest now names a package the lockfile does not have, and no deps sync
        // has run: the preview's frozen install refuses it.
        yield* commitFiles({
          changes: { "package.json": UNINSTALLABLE_PACKAGE_JSON },
          workspaceId,
        });
        const db = yield* DB;
        const entry = yield* db.query.templatingWorkspaceEntry.findFirst({
          where: { path: "reactEmail/welcome.tsx", workspaceId },
        });

        const failure = yield* Effect.flip(
          preview({ entryId: entry?.id ?? "", subjectOverride: "Hi", workspaceId }),
        );

        expect(failure).toMatchObject({ code: "failed", message: "Preview install failed." });
        expect(failure.detail).toContain("lockfile had changes, but lockfile is frozen");
        expect(failure.detail).not.toContain("relayit-preview-");
      }).pipe(Effect.provide(services)),
    120_000,
  );
});
