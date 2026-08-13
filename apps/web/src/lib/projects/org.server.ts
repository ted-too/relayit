import { DB } from "@repo/persistence/db/effect";
import { Data, Effect } from "effect";

export class ProjectLookupError extends Data.TaggedError("ProjectLookupError")<{
  readonly cause?: unknown;
  readonly code: "not_found" | "failed";
  /** Static human-readable summary — do not interpolate identifiers into this. */
  readonly message: string;
}> {}

export interface ProjectRef {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
}

export const requireOrganizationBySlug = (orgSlug: string) =>
  Effect.gen(function* () {
    const db = yield* DB;
    const org = yield* db.query.organization
      .findFirst({
        columns: { id: true, name: true, slug: true },
        where: { slug: orgSlug },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProjectLookupError({
              cause,
              code: "failed",
              message: "Failed to load Project.",
            })
        )
      );

    if (!org) {
      return yield* new ProjectLookupError({
        code: "not_found",
        message: "Project not found.",
      });
    }

    return org satisfies ProjectRef;
  });
