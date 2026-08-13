import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DB } from "@repo/persistence/db/effect";
import { templatingWorkspaceEntry } from "@repo/persistence/db/schema";
import { renderSealedReactEmailArtifact } from "@repo/template-render/react-email";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import {
  checkoutRefToDirectory,
  HOSTED_DEV_REF,
  withWorkspaceGitLock,
} from "../git";
import { TemplatingBuilderError } from "../rpc/errors";
import { bundleReactEmailEntry } from "./bundle";
import { assertHardenedPackageJson } from "./package-json";

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
              isNull(templatingWorkspaceEntry.deletedAt)
            )
          )
          .limit(1)
          .pipe(
            Effect.mapError(
              () =>
                new TemplatingBuilderError({
                  code: "failed",
                  message: "Failed to load workspace entry.",
                })
            )
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
            try: () => fs.mkdtemp(path.join(os.tmpdir(), "relayit-preview-")),
          }),
          (dir) =>
            Effect.promise(() => fs.rm(dir, { force: true, recursive: true }))
        );

        const checkedOut = yield* checkoutRefToDirectory({
          destDir: tempDir,
          ref: HOSTED_DEV_REF,
          workspaceId: input.workspaceId,
        });

        const packageJson = yield* Effect.tryPromise({
          catch: () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Failed to read package.json.",
            }),
          try: () => fs.readFile(path.join(tempDir, "package.json"), "utf8"),
        });
        yield* assertHardenedPackageJson(packageJson);

        yield* Effect.tryPromise({
          catch: () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Preview install failed.",
            }),
          try: async () => {
            const install = Bun.spawn(
              ["bun", "install", "--frozen-lockfile", "--ignore-scripts"],
              {
                cwd: tempDir,
                env: { ...process.env, BUN_INSTALL_IGNORE_SCRIPTS: "1" },
                stderr: "pipe",
                stdout: "pipe",
              }
            );
            if ((await install.exited) !== 0) {
              throw new Error("install failed");
            }
          },
        });

        const artifact = yield* bundleReactEmailEntry({
          entryPath: entry.path,
          workspaceDir: tempDir,
        });

        const rendered = yield* Effect.tryPromise({
          catch: () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Preview render failed.",
            }),
          try: () =>
            renderSealedReactEmailArtifact({
              artifact,
              // Preview only — never merge PreviewProps on the send path.
              mergePreviewProps: true,
              props: input.props ?? {},
              subjectOverride: input.subjectOverride,
            }),
        });

        if (!rendered.ok) {
          return yield* new TemplatingBuilderError({
            code: "failed",
            message: "Preview render failed.",
          });
        }

        return {
          commitSha: checkedOut.commitSha,
          html: rendered.value.html,
          props: rendered.value.props,
          subject: rendered.value.subject,
          ...(rendered.value.text === undefined
            ? {}
            : { text: rendered.value.text }),
        } satisfies PreviewResult;
      })
    )
  );
