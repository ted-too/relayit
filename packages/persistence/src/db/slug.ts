import { and, count, eq, like, type SQL } from "drizzle-orm";
import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import type { DatabaseExecutor } from "./effect";

export interface GenerateDbSlugOptions {
  /**
   * Extra WHERE fragment ANDed with the slug match (e.g. organization id,
   * `archivedAt IS NULL`, exclude current row id).
   */
  readonly scope?: SQL;
}

/** Lowercase kebab-case slug from free text (names, titles, etc.). */
export const slugify = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * Derive a unique slug from a human name for a table that has a `slug` column.
 * Pass {@link GenerateDbSlugOptions.scope} when uniqueness is scoped (template
 * within organization, active-only, etc.).
 */
export const generateDbSlug = <T extends AnyPgTable & { slug: AnyPgColumn }>(
  db: DatabaseExecutor,
  table: T,
  name: string,
  options?: GenerateDbSlugOptions
): Effect.Effect<string, EffectDrizzleQueryError> =>
  Effect.gen(function* () {
    const baseSlug = slugify(name) || "item";
    const scope = options?.scope;

    const existingRows = yield* db
      .select({ count: count() })
      // @ts-expect-error - drizzle orm bug see - https://github.com/drizzle-team/drizzle-orm/issues/4069
      .from(table)
      .where(
        scope ? and(eq(table.slug, baseSlug), scope) : eq(table.slug, baseSlug)
      );

    if ((existingRows[0]?.count ?? 0) === 0) {
      return baseSlug;
    }

    const pattern = `${baseSlug}-%`;
    const existingSlugs = yield* db
      .select({ slug: table.slug })
      // @ts-expect-error - drizzle orm bug see - https://github.com/drizzle-team/drizzle-orm/issues/4069
      .from(table)
      .where(
        scope
          ? and(like(table.slug, pattern), scope)
          : like(table.slug, pattern)
      );

    const escaped = baseSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const existingNumbers = existingSlugs
      .map((row) => {
        const slug = row.slug as string;
        const match = slug.match(new RegExp(`^${escaped}-(\\d+)$`));
        return match ? Number.parseInt(match[1] ?? "0", 10) : 0;
      })
      .filter((num) => num > 0);

    const nextNumber =
      existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 2;

    return `${baseSlug}-${nextNumber}`;
  });
