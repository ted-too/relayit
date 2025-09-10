import { db } from "@repo/shared/db";
import { count, eq, like } from "drizzle-orm";
import type { AnyPgColumn, AnyPgTable } from "drizzle-orm/pg-core";
import slugify from "slugify";

export async function generateDbSlug<
  T extends AnyPgTable & { slug: AnyPgColumn },
>(table: T, name: string): Promise<string> {
  const baseSlug = slugify(name, { lower: true, strict: true });

  // Check if base slug exists
  const existingCount = (
    await db
      .select({ count: count() })
      // @ts-expect-error - This is a drizzle orm bug see - https://github.com/drizzle-team/drizzle-orm/issues/4069
      .from(table)
      .where(eq(table.slug, baseSlug))
  )[0].count;

  if (existingCount === 0) {
    return baseSlug;
  }

  // Find all existing slugs with the same base pattern
  const pattern = `${baseSlug}-%`;
  const existingSlugs = await db
    .select({ slug: table.slug })
    // @ts-expect-error - This is a drizzle orm bug see - https://github.com/drizzle-team/drizzle-orm/issues/4069
    .from(table)
    .where(like(table.slug, pattern));

  // Extract numbers from existing slugs and find the next available number
  const existingNumbers = existingSlugs
    .map((row) => {
      const slug = row.slug as string;
      const match = slug.match(
        new RegExp(
          `^${baseSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`
        )
      );
      return match ? Number.parseInt(match[1], 10) : 0;
    })
    .filter((num) => num > 0);

  const nextNumber =
    existingNumbers.length > 0 ? Math.max(...existingNumbers) + 1 : 2;

  return `${baseSlug}-${nextNumber}`;
}
