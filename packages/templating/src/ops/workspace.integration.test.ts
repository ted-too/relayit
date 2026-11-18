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
import { makeRedisLive } from "@repo/redis";
import { renderSealedReactEmailArtifact } from "@repo/template-render/react-email";
import { Effect, Layer } from "effect";
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
});
