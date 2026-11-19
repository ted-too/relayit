import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { DB } from "@repo/persistence/db/effect";
import { templatingWorkspaceEntry } from "@repo/persistence/db/schema";
import { renderSealedReactEmailArtifact } from "@repo/template-render/react-email";
import { and, eq, isNull } from "drizzle-orm";
import { Data, Effect } from "effect";
import { checkoutRefToDirectory, HOSTED_DEV_REF, withWorkspaceGitLock } from "../git";
import { TemplatingBuilderError } from "../rpc/errors";
import { runBunInstall } from "./bun-install";
import { bundleReactEmailEntry } from "./bundle";
import { hardenCheckedOutPackageJson } from "./package-json";
import { workspaceToolOutput } from "./tool-output";

// The Effect language service refuses an untyped `catch`, so the thrown value is carried
// in this until it is logged.
class PreviewRenderNotRun extends Data.TaggedError("PreviewRenderNotRun")<{
  readonly cause: unknown;
}> {}

export interface PreviewResult {
  commitSha: string;
  html: string;
  /** Resolved props after merging Entry `PreviewProps` under the request props. */
  props: Record<string, unknown>;
  subject: string;
  text?: string;
}

/**
 * Ephemeral seal+render of a Workspace Entry from `dev` without advancing
 * `main` or writing live artifacts.
 */
export const previewHostedWorkspaceEntry = (input: {
  entryId: string;
  props?: Record<string, unknown>;
  subjectOverride?: string;
  workspaceId: string;
}) =>
  withWorkspaceGitLock(
    input.workspaceId,
    Effect.scoped(
      Effect.gen(function* () {
        const db = yield* DB;
        const [entry] = yield* db
          .select()
          .from(templatingWorkspaceEntry)
          .where(
            and(
              eq(templatingWorkspaceEntry.id, input.entryId),
              eq(templatingWorkspaceEntry.workspaceId, input.workspaceId),
              isNull(templatingWorkspaceEntry.deletedAt),
            ),
          )
          .limit(1)
          .pipe(
            Effect.mapError(
              () =>
                new TemplatingBuilderError({
                  code: "failed",
                  message: "Failed to load workspace entry.",
                }),
            ),
          );

        if (!entry) {
          return yield* new TemplatingBuilderError({
            code: "not_found",
            message: "Workspace Entry not found.",
          });
        }

        const tempDir = yield* Effect.acquireRelease(
          Effect.tryPromise({
            catch: () =>
              new TemplatingBuilderError({
                code: "failed",
                message: "Failed to create preview temp directory.",
              }),
            try: () => NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "relayit-preview-")),
          }),
          (dir) => Effect.promise(() => NodeFSP.rm(dir, { force: true, recursive: true })),
        );

        const checkedOut = yield* checkoutRefToDirectory({
          destDir: tempDir,
          ref: HOSTED_DEV_REF,
          workspaceId: input.workspaceId,
        });

        yield* hardenCheckedOutPackageJson(tempDir);

        const install = yield* runBunInstall({
          args: ["--frozen-lockfile", "--ignore-scripts"],
          cwd: tempDir,
          operation: "preview",
        });
        if (!install.ok) {
          return yield* new TemplatingBuilderError({
            code: "failed",
            // An install that could not be started, or was killed, is the host's failure,
            // not the workspace's: it is in the builder's log and gets no `detail`.
            ...(install.exitCode === null
              ? {}
              : { detail: workspaceToolOutput(install.stderr, tempDir) }),
            message: "Preview install failed.",
          });
        }

        const artifact = yield* bundleReactEmailEntry({
          entryPath: entry.path,
          workspaceDir: tempDir,
        });

        const rendered = yield* Effect.tryPromise({
          catch: (cause) => new PreviewRenderNotRun({ cause }),
          try: () =>
            renderSealedReactEmailArtifact({
              artifact,
              // Preview only — never merge PreviewProps on the send NodePath.
              mergePreviewProps: true,
              props: input.props ?? {},
              subjectOverride: input.subjectOverride,
            }),
        }).pipe(
          // The isolate could not be run at all: the host's failure, so it is logged
          // here and not put in a `detail` the Project reads.
          Effect.tapError(({ cause }) => Effect.logWarning("Preview render could not run", cause)),
          Effect.mapError(
            () =>
              new TemplatingBuilderError({
                code: "failed",
                message: "Preview render failed.",
              }),
          ),
        );

        if (!rendered.ok) {
          return yield* new TemplatingBuilderError({
            code: "failed",
            detail: workspaceToolOutput(rendered.error.message, tempDir),
            message: "Preview render failed.",
          });
        }

        return {
          commitSha: checkedOut.commitSha,
          html: rendered.value.html,
          props: rendered.value.props,
          subject: rendered.value.subject,
          ...(rendered.value.text === undefined ? {} : { text: rendered.value.text }),
        } satisfies PreviewResult;
      }),
    ),
  );
