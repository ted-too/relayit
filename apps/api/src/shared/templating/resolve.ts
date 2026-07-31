import type { DbOrTx, Template } from "@repo/api/db";

const TEMPLATE_TYPE_ID_PREFIX = "tmpl_";

/** True when `value` is a Template typeid (`tmpl_…`), not a slug. */
export function isTemplateTypeId(value: string): boolean {
  return value.startsWith(TEMPLATE_TYPE_ID_PREFIX);
}

/**
 * Resolve a send-path Template ref: typeid (`tmpl_…`) or active Project slug.
 * Archived Templates are not resolved (by id or slug).
 */
export async function resolveTemplateRef({
  db,
  organizationId,
  idOrSlug,
}: {
  db: DbOrTx;
  organizationId: string;
  idOrSlug: string;
}): Promise<Template | null> {
  if (isTemplateTypeId(idOrSlug)) {
    return (
      (await db.query.template.findFirst({
        where: (table, { eq, and, isNull }) =>
          and(
            eq(table.id, idOrSlug),
            eq(table.organizationId, organizationId),
            isNull(table.archivedAt)
          ),
      })) ?? null
    );
  }

  return (
    (await db.query.template.findFirst({
      where: (table, { eq, and, isNull }) =>
        and(
          eq(table.slug, idOrSlug),
          eq(table.organizationId, organizationId),
          isNull(table.archivedAt)
        ),
    })) ?? null
  );
}

/** @deprecated Prefer {@link resolveTemplateRef}. */
export function resolveTemplateId({
  db,
  organizationId,
  templateId,
}: {
  db: DbOrTx;
  organizationId: string;
  templateId: string;
}): Promise<Template | null> {
  return resolveTemplateRef({ db, organizationId, idOrSlug: templateId });
}
