import { db, schema } from "@repo/api/db";
import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import { generateDbSlug, isSlugTaken } from "@repo/api/slug";
import {
  createTemplateBodySchema,
  patchTemplateBodySchema,
  putTemplateEmailChannelBodySchema,
  templateIdParamsSchema,
} from "@repo/api/validators/routes/projects/templating/templates";
import { and, eq, isNull, ne } from "drizzle-orm";
import { Elysia, status } from "elysia";
import slugify from "slugify";

function activeTemplateSlugScope(
  organizationId: string,
  excludeTemplateId?: string
) {
  return and(
    eq(schema.template.organizationId, organizationId),
    isNull(schema.template.archivedAt),
    excludeTemplateId ? ne(schema.template.id, excludeTemplateId) : undefined
  );
}

function findTemplateInOrganization(
  templateId: string,
  organizationId: string
) {
  return db.query.template.findFirst({
    where: (table, { eq, and }) =>
      and(eq(table.id, templateId), eq(table.organizationId, organizationId)),
    with: {
      channelVariants: {
        with: {
          workspaceEntry: true,
        },
      },
    },
  });
}

function isWorkspaceEntryPickable(
  entry: typeof schema.templatingWorkspaceEntry.$inferSelect | null | undefined
) {
  return Boolean(entry && !entry.deletedAt && entry.artifactStorageKey);
}

function serializeTemplate(
  row: NonNullable<Awaited<ReturnType<typeof findTemplateInOrganization>>>
) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    name: row.name,
    slug: row.slug,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    channelVariants: row.channelVariants.map((variant) => {
      const entry = variant.workspaceEntry;
      const missingLink = !variant.workspaceEntryId;
      const broken =
        variant.engine === "reactEmail" &&
        (missingLink || !isWorkspaceEntryPickable(entry));

      return {
        id: variant.id,
        channel: variant.channel,
        engine: variant.engine,
        content: variant.content,
        variables: variant.variables,
        workspaceEntryId: variant.workspaceEntryId,
        broken,
        createdAt: variant.createdAt,
        updatedAt: variant.updatedAt,
      };
    }),
  };
}

export const templatingTemplatesRoutes = new Elysia({
  prefix: "/templating/templates",
})
  .use(betterAuthOrganization)
  .guard({
    organization: true,
    auth: true,
  })
  .get("/", async ({ organization, request }) => {
    const hasPermission = await auth.api.hasPermission({
      headers: request.headers,
      body: {
        organizationId: organization.id,
        permissions: { template: ["read"] },
      },
    });

    if (!hasPermission) {
      return status(403, "You do not have permission to read Templates");
    }

    const rows = await db.query.template.findMany({
      where: (table, { eq }) => eq(table.organizationId, organization.id),
      orderBy: (table, { asc }) => [asc(table.createdAt)],
      with: {
        channelVariants: {
          with: {
            workspaceEntry: true,
          },
        },
      },
    });

    return rows.map(serializeTemplate);
  })
  .post(
    "/",
    async ({ body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { template: ["create"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to create Templates");
      }

      const slug = await generateDbSlug(schema.template, body.name, {
        scope: activeTemplateSlugScope(organization.id),
      });

      const [created] = await db
        .insert(schema.template)
        .values({
          organizationId: organization.id,
          name: body.name,
          slug,
          updatedAt: new Date(),
        })
        .returning();

      return serializeTemplate({
        ...created,
        channelVariants: [],
      });
    },
    { body: createTemplateBodySchema }
  )
  .get(
    "/:id",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { template: ["read"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to read Templates");
      }

      const existing = await findTemplateInOrganization(
        params.id,
        organization.id
      );

      if (!existing) {
        return status(404, "Template not found");
      }

      return serializeTemplate(existing);
    },
    { params: templateIdParamsSchema }
  )
  .patch(
    "/:id",
    async ({ params, body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { template: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to update Templates");
      }

      const existing = await findTemplateInOrganization(
        params.id,
        organization.id
      );

      if (!existing) {
        return status(404, "Template not found");
      }

      if (existing.archivedAt) {
        return status(409, "Archived Templates cannot be updated");
      }

      const nextName = body.name ?? existing.name;
      const nameChanged = nextName !== existing.name;

      let nextSlug = existing.slug;
      if (body.slug !== undefined) {
        const normalized =
          slugify(body.slug, { lower: true, strict: true }) || "";
        if (!normalized) {
          return status(400, "Slug is invalid");
        }
        if (normalized !== existing.slug) {
          const taken = await isSlugTaken(schema.template, normalized, {
            scope: activeTemplateSlugScope(organization.id, existing.id),
          });
          if (taken) {
            return status(
              409,
              "A Template with this slug already exists in the Project"
            );
          }
          nextSlug = normalized;
        }
      } else if (nameChanged) {
        nextSlug = await generateDbSlug(schema.template, nextName, {
          scope: activeTemplateSlugScope(organization.id, existing.id),
        });
      }

      if (nextName === existing.name && nextSlug === existing.slug) {
        return serializeTemplate(existing);
      }

      const [updated] = await db
        .update(schema.template)
        .set({ name: nextName, slug: nextSlug })
        .where(
          and(
            eq(schema.template.id, existing.id),
            eq(schema.template.organizationId, organization.id),
            isNull(schema.template.archivedAt)
          )
        )
        .returning();

      if (!updated) {
        return serializeTemplate(existing);
      }

      return serializeTemplate({
        ...existing,
        ...updated,
      });
    },
    { params: templateIdParamsSchema, body: patchTemplateBodySchema }
  )
  .post(
    "/:id/archive",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { template: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to archive Templates");
      }

      const existing = await findTemplateInOrganization(
        params.id,
        organization.id
      );

      if (!existing) {
        return status(404, "Template not found");
      }

      if (existing.archivedAt) {
        return serializeTemplate(existing);
      }

      const [archived] = await db
        .update(schema.template)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(schema.template.id, existing.id),
            eq(schema.template.organizationId, organization.id),
            isNull(schema.template.archivedAt)
          )
        )
        .returning();

      return serializeTemplate({
        ...existing,
        ...(archived ?? {}),
      });
    },
    { params: templateIdParamsSchema }
  )
  .put(
    "/:id/channels/email",
    async ({ params, body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { template: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to update Templates");
      }

      const existing = await findTemplateInOrganization(
        params.id,
        organization.id
      );

      if (!existing) {
        return status(404, "Template not found");
      }

      if (existing.archivedAt) {
        return status(409, "Archived Templates cannot be updated");
      }

      if (body.engine === "reactEmail") {
        const entry = await db.query.templatingWorkspaceEntry.findFirst({
          where: (table, { eq, and, isNull }) =>
            and(eq(table.id, body.workspaceEntryId), isNull(table.deletedAt)),
          with: {
            workspace: true,
          },
        });

        if (
          !entry ||
          entry.workspace.organizationId !== organization.id ||
          entry.workspace.kind !== "reactEmail"
        ) {
          return status(404, "Workspace Entry not found");
        }

        if (!isWorkspaceEntryPickable(entry)) {
          return status(
            409,
            "Workspace Entry is not pickable until a successful Publish"
          );
        }
      }

      const now = new Date();
      const values =
        body.engine === "primitive"
          ? {
              templateId: existing.id,
              channel: "email" as const,
              engine: "primitive" as const,
              content: body.content,
              variables: body.variables ?? {},
              workspaceEntryId: null,
              updatedAt: now,
            }
          : {
              templateId: existing.id,
              channel: "email" as const,
              engine: "reactEmail" as const,
              content: { subject: body.subject },
              variables: null,
              workspaceEntryId: body.workspaceEntryId,
              updatedAt: now,
            };

      const currentEmail = existing.channelVariants.find(
        (variant) => variant.channel === "email"
      );

      if (currentEmail) {
        await db
          .update(schema.templateChannelVariant)
          .set(values)
          .where(eq(schema.templateChannelVariant.id, currentEmail.id));
      } else {
        await db.insert(schema.templateChannelVariant).values({
          ...values,
          createdAt: now,
        });
      }

      const refreshed = await findTemplateInOrganization(
        existing.id,
        organization.id
      );

      if (!refreshed) {
        return status(404, "Template not found");
      }

      return serializeTemplate(refreshed);
    },
    {
      params: templateIdParamsSchema,
      body: putTemplateEmailChannelBodySchema,
    }
  );
