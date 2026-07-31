import { db } from "@repo/api/db";
import { and, count, eq, like, type SQL } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import slugify from "slugify";

export interface GenerateDbSlugOptions {
  /**
   * Extra WHERE fragment ANDed with the slug match (e.g. organization id,
   * `archivedAt IS NULL`, exclude current row id).
   */
  scope?: SQL;
}

/**
 * Derive a unique slug from a human name for a table that has a `slug` column.
 * Pass {@link GenerateDbSlugOptions.scope} when uniqueness is scoped (Project,
 * active-only, etc.).
 */
export async function generateDbSlug<
  T extends AnyPgTable & { slug: AnyPgColumn },
>(table: T, name: string, options?: GenerateDbSlugOptions): Promise<string> {
  const baseSlug = slugify(name, { lower: true, strict: true }) || "item";
  const scope = options?.scope;

  const existingCount = (
    await db
      .select({ count: count() })
      // @ts-expect-error - This is a drizzle orm bug see - https://github.com/drizzle-team/drizzle-orm/issues/4069
      .from(table)
      .where(
        scope ? and(eq(table.slug, baseSlug), scope) : eq(table.slug, baseSlug)
      )
  )[0].count;

  if (existingCount === 0) {
    return baseSlug;
  }

  const pattern = `${baseSlug}-%`;
  const existingSlugs = await db
    .select({ slug: table.slug })
    // @ts-expect-error - This is a drizzle orm bug see - https://github.com/drizzle-team/drizzle-orm/issues/4069
    .from(table)
    .where(
      scope ? and(like(table.slug, pattern), scope) : like(table.slug, pattern)
    );

  const escaped = baseSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const existingNumbers = existingSlugs
    .map((row) => {
      const slug = row.slug as string;
      const match = slug.match(new RegExp(`^${escaped}-(\\d+)$`));
      return match ? Number.parseInt(match[1], 10) : 0;
    })
    .filter((num) => num > 0);

  const nextNumber =
    existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 2;

  return `${baseSlug}-${nextNumber}`;
}

export async function isSlugTaken<T extends AnyPgTable & { slug: AnyPgColumn }>(
  table: T,
  slug: string,
  options?: GenerateDbSlugOptions
): Promise<boolean> {
  const scope = options?.scope;
  const existingCount = (
    await db
      .select({ count: count() })
      // @ts-expect-error - This is a drizzle orm bug see - https://github.com/drizzle-team/drizzle-orm/issues/4069
      .from(table)
      .where(scope ? and(eq(table.slug, slug), scope) : eq(table.slug, slug))
  )[0].count;

  return existingCount > 0;
}
