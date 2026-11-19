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
import { withWorkspaceGitLock } from "../git";
import { commitFiles, listFiles, preview, publish } from "./workspace";

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
    "does not quote a file outside the workspace that an Entry's import fails on",
    () =>
      Effect.gen(function* () {
        const outside = yield* Effect.acquireRelease(
          Effect.promise(() =>
            NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "relayit-host-file-")),
          ),
          (dir) => Effect.promise(() => NodeFSP.rm(dir, { force: true, recursive: true })),
        );
        // Not valid JSON, so the bundler's own message quotes it: 'found "hunter2"'.
        const hostFile = NodePath.join(outside, "settings.json");
        yield* Effect.promise(() => NodeFSP.writeFile(hostFile, '{ "host": 1 hunter2 }\n'));
        const workspaceId = yield* insertWorkspace;
        yield* commitFiles({
          changes: {
            "reactEmail/reaching.tsx": `import settings from ${JSON.stringify(hostFile)};\nexport default function ReachingEmail() {\n  return <div>{String(settings)}</div>;\n}\n`,
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
          detail: "A file outside the workspace failed to build.",
          message: "Failed to bundle workspace entry.",
        });
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
