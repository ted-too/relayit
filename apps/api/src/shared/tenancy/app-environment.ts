import { type DbOrTx, schema } from "@repo/api/db";
import { isNull } from "drizzle-orm";

/**
 * Find (or create) the `organizationAppEnvironment` row for an org + optional
 * `app`/`environment` pair. A null app or environment denotes the org's default
 * (unscoped) row.
 *
 * The `app`/`environment` values are stored verbatim — we leave their format to
 * the caller's discretion rather than normalizing them. Validate/normalize at
 * the API boundary if you need to constrain them; lookups here match the exact
 * stored value.
 */
export async function findOrCreateAppEnvironment({
  db,
  organizationId,
  app = null,
  environment = null,
}: {
  db: DbOrTx;
  organizationId: string;
  app?: string | null;
  environment?: string | null;
}) {
  const existingAppEnvironment =
    await db.query.organizationAppEnvironment.findFirst({
      where: (table, { eq, and }) =>
        and(
          eq(table.organizationId, organizationId),
          app ? eq(table.app, app) : isNull(table.app),
          environment
            ? eq(table.environment, environment)
            : isNull(table.environment)
        ),
    });

  if (existingAppEnvironment) {
    return existingAppEnvironment;
  }

  const [newAppEnvironment] = await db
    .insert(schema.organizationAppEnvironment)
    .values({
      organizationId,
      app,
      environment,
    })
    .returning();

  return newAppEnvironment;
}
