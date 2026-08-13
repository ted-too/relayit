import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { DB } from "@repo/persistence/db/effect";
import {
  templatingWorkspace,
  templatingWorkspaceEntry,
} from "@repo/persistence/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { syncWorkspaceEntriesForPaths } from "../entries";
import {
  checkoutRefToDirectory,
  getRef,
  HOSTED_DEV_REF,
  HOSTED_MAIN_REF,
  updateRef,
  withWorkspaceGitLock,
} from "../git";
import { isReactEmailEntryPath } from "../kinds/react-email/paths";
import { inferReactEmailPropsFromSource } from "../kinds/react-email/props";
import { TemplatingBuilderError } from "../rpc/errors";
import { newArtifactRevision, templatingArtifacts } from "../storage";
import { bundleReactEmailEntry } from "./bundle";
import { assertHardenedPackageJson } from "./package-json";

export interface PublishResult {
  commitSha: string;
  entries: Array<{ id: string; path: string; pickable: boolean }>;
}

const recordBuildError = (workspaceId: string, message: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    yield* db
      .update(templatingWorkspace)
      .set({
        lastBuildError: message,
        updatedAt: new Date(),
      })
      .where(eq(templatingWorkspace.id, workspaceId))
      .pipe(Effect.ignore);
  });

const collectEntryPaths = (root: string) =>
  Effect.tryPromise({
    catch: () => [] as string[],
    try: async () => {
      const dir = path.join(root, "reactEmail");
      try {
        const names = await fs.readdir(dir);
        return names
          .map((name) => path.join("reactEmail", name))
          .filter((p) => isReactEmailEntryPath(p));
      } catch {
        return [];
      }
    },
  }).pipe(Effect.orElseSucceed(() => [] as string[]));

/**
 * Publish hosted workspace: build from `dev`, seal artifacts, advance `main`
 * only on full success.
 */
export const publishHostedWorkspace = (input: { workspaceId: string }) =>
  withWorkspaceGitLock(
    input.workspaceId,
    Effect.scoped(
      Effect.gen(function* () {
        const tempDir = yield* Effect.acquireRelease(
          Effect.tryPromise({
            catch: () =>
              new TemplatingBuilderError({
                code: "failed",
                message: "Failed to create publish temp directory.",
              }),
            try: () => fs.mkdtemp(path.join(os.tmpdir(), "relayit-publish-")),
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

        yield* assertHardenedPackageJson(packageJson).pipe(
          Effect.tapError((error) =>
            recordBuildError(input.workspaceId, error.message)
          )
        );

        const installResult = yield* Effect.tryPromise({
          catch: () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Publish install failed.",
            }),
          try: async () => {
            try {
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
                const stderr = await new Response(install.stderr).text();
                return {
                  detail: stderr || "Publish install failed.",
                  ok: false as const,
                };
              }
              return { ok: true as const };
            } catch {
              return {
                detail: "Publish install failed.",
                ok: false as const,
              };
            }
          },
        });
        if (!installResult.ok) {
          yield* recordBuildError(input.workspaceId, installResult.detail);
          return yield* new TemplatingBuilderError({
            code: "failed",
            message: "Publish install failed.",
          });
        }

        const entryFiles = yield* collectEntryPaths(tempDir);
        if (entryFiles.length === 0) {
          const error = new TemplatingBuilderError({
            code: "failed",
            message: "No Workspace Entries to publish.",
          });
          yield* recordBuildError(input.workspaceId, error.message);
          return yield* error;
        }

        yield* syncWorkspaceEntriesForPaths({
          entryPaths: entryFiles,
          workspaceId: input.workspaceId,
        });

        const db = yield* DB;
        const entries = yield* db
          .select()
          .from(templatingWorkspaceEntry)
          .where(
            and(
              eq(templatingWorkspaceEntry.workspaceId, input.workspaceId),
              isNull(templatingWorkspaceEntry.deletedAt)
            )
          )
          .pipe(
            Effect.mapError(
              () =>
                new TemplatingBuilderError({
                  code: "failed",
                  message: "Failed to load workspace entries.",
                })
            )
          );

        const active = entries.filter((entry) =>
          isReactEmailEntryPath(entry.path)
        );
        const staged: Array<{
          artifact: Uint8Array;
          entryId: string;
          path: string;
          props: ReturnType<typeof inferReactEmailPropsFromSource>;
          revision: string;
        }> = [];

        for (const entry of active) {
          const source = yield* Effect.tryPromise({
            catch: () =>
              new TemplatingBuilderError({
                code: "failed",
                message: "Failed to read workspace entry source.",
              }),
            try: () => fs.readFile(path.join(tempDir, entry.path), "utf8"),
          });
          const artifact = yield* bundleReactEmailEntry({
            entryPath: entry.path,
            workspaceDir: tempDir,
          }).pipe(
            Effect.tapError((error) =>
              recordBuildError(input.workspaceId, error.message)
            )
          );
          staged.push({
            artifact,
            entryId: entry.id,
            path: entry.path,
            props: inferReactEmailPropsFromSource(source),
            revision: newArtifactRevision(),
          });
        }

        const builtAt = new Date();
        const resultEntries: PublishResult["entries"] = [];

        for (const item of staged) {
          yield* templatingArtifacts
            .upload(
              {
                entryId: item.entryId,
                revision: item.revision,
                workspaceId: input.workspaceId,
              },
              item.artifact,
              { contentType: "application/javascript" }
            )
            .pipe(
              Effect.mapError(
                () =>
                  new TemplatingBuilderError({
                    code: "failed",
                    message: "Failed to upload sealed artifact.",
                  })
              ),
              Effect.tapError((error: TemplatingBuilderError) =>
                recordBuildError(input.workspaceId, error.message)
              )
            );

          const storageKey = yield* templatingArtifacts
            .key({
              entryId: item.entryId,
              revision: item.revision,
              workspaceId: input.workspaceId,
            })
            .pipe(
              Effect.mapError(
                () =>
                  new TemplatingBuilderError({
                    code: "failed",
                    message: "Failed to resolve artifact storage key.",
                  })
              )
            );

          yield* db
            .update(templatingWorkspaceEntry)
            .set({
              artifactCommitSha: checkedOut.commitSha,
              artifactStorageKey: storageKey,
              builtAt,
              inferredProps: item.props,
              updatedAt: builtAt,
            })
            .where(eq(templatingWorkspaceEntry.id, item.entryId))
            .pipe(
              Effect.mapError(
                () =>
                  new TemplatingBuilderError({
                    code: "failed",
                    message: "Failed to persist sealed entry metadata.",
                  })
              )
            );

          resultEntries.push({
            id: item.entryId,
            path: item.path,
            pickable: true,
          });
        }

        const previousMain = yield* getRef(input.workspaceId, HOSTED_MAIN_REF);
        yield* updateRef({
          expectedSha: previousMain,
          name: HOSTED_MAIN_REF,
          sha: checkedOut.commitSha,
          workspaceId: input.workspaceId,
        }).pipe(
          Effect.tapError((error) =>
            recordBuildError(input.workspaceId, error.message)
          )
        );

        yield* db
          .update(templatingWorkspace)
          .set({
            lastBuildAt: builtAt,
            lastBuildError: null,
            updatedAt: builtAt,
          })
          .where(eq(templatingWorkspace.id, input.workspaceId))
          .pipe(
            Effect.mapError(
              () =>
                new TemplatingBuilderError({
                  code: "failed",
                  message: "Failed to clear workspace build error.",
                })
            )
          );

        return {
          commitSha: checkedOut.commitSha,
          entries: resultEntries,
        } satisfies PublishResult;
      })
    )
  );
