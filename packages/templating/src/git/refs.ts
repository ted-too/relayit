import { DB } from "@repo/persistence/db/effect";
import { templatingWorkspaceRef } from "@repo/persistence/db/schema";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { TemplatingBuilderError } from "../rpc/errors";

export const getRef = (workspaceId: string, name: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const row = yield* db.query.templatingWorkspaceRef
      .findFirst({
        where: { name, workspaceId },
      })
      .pipe(
        Effect.mapError(
          () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Failed to load workspace ref.",
            })
        )
      );
    return row?.sha ?? null;
  });

export const listRefs = (workspaceId: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const rows = yield* db.query.templatingWorkspaceRef
      .findMany({
        where: { workspaceId },
      })
      .pipe(
        Effect.mapError(
          () =>
            new TemplatingBuilderError({
              code: "failed",
              message: "Failed to list workspace refs.",
            })
        )
      );
    return rows.map((row) => ({ name: row.name, sha: row.sha }));
  });

/** Compare-and-swap ref update. Pass `expectedSha: null` to create. */
export const updateRef = (input: {
  expectedSha: string | null;
  name: string;
  sha: string;
  workspaceId: string;
}) =>
  Effect.gen(function* () {
    const { expectedSha, name, sha, workspaceId } = input;
    const existing = yield* getRef(workspaceId, name);

    if (existing !== expectedSha) {
      return yield* new TemplatingBuilderError({
        code: "failed",
        message: "Workspace ref update conflicted; retry.",
      });
    }

    const db = yield* DB;

    if (existing === null) {
      yield* db
        .insert(templatingWorkspaceRef)
        .values({
          name,
          sha,
          workspaceId,
        })
        .pipe(
          Effect.mapError(
            () =>
              new TemplatingBuilderError({
                code: "failed",
                message: "Failed to create workspace ref.",
              })
          )
        );
    } else {
      yield* db
        .update(templatingWorkspaceRef)
        .set({ sha, updatedAt: new Date() })
        .where(
          and(
            eq(templatingWorkspaceRef.workspaceId, workspaceId),
            eq(templatingWorkspaceRef.name, name)
          )
        )
        .pipe(
          Effect.mapError(
            () =>
              new TemplatingBuilderError({
                code: "failed",
                message: "Failed to update workspace ref.",
              })
          )
        );
    }

    return { sha };
  });
