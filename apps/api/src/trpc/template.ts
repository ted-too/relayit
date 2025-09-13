import { db, schema } from "@repo/shared/db";
import type { TemplateWithVersions } from "@repo/shared/db/schema/template";
import {
  channelContentSchema,
  createTemplateSchema,
  updateTemplateSchema,
} from "@repo/shared/forms";
import { renderEmailServer } from "@repo/template-render/react-email/server";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import SuperJSON from "superjson";
import { z } from "zod";
import { authdOrganizationProcedure, router } from ".";

export const templateRouter = router({
  list: authdOrganizationProcedure.query(async ({ ctx }) => {
    return await db.query.template.findMany({
      where: (table, { eq }) =>
        eq(table.organizationId, ctx.session.activeOrganization.id),
      with: {
        currentVersion: {
          with: {
            channelVersions: true,
          },
        },
      },
      orderBy: (table, { desc }) => [desc(table.createdAt)],
    });
  }),
  checkSlug: authdOrganizationProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const exists = await db.query.template.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.organizationId, ctx.session.activeOrganization.id),
            eq(table.slug, input.slug)
          ),
      });

      return { exists: !!exists };
    }),
  getBySlug: authdOrganizationProcedure
    .input(z.object({ slug: z.string() }))
    .query(async ({ ctx, input }) => {
      const template = await db.query.template.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.organizationId, ctx.session.activeOrganization.id),
            eq(table.slug, input.slug)
          ),
        with: {
          currentVersion: {
            with: {
              channelVersions: true,
            },
          },
        },
      });

      if (!template) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
      }

      // Separately fetch all versions to avoid relation ambiguity
      const allVersions = await db.query.templateVersion.findMany({
        where: (table, { eq }) => eq(table.templateId, template.id),
        with: {
          channelVersions: true,
        },
        orderBy: (table, { desc }) => [desc(table.version)],
      });

      // Transform to TemplateWithVersions structure
      const { currentVersion, ...templateBase } = template;

      if (!currentVersion) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Template has no current version",
        });
      }

      return {
        ...templateBase,
        currentVersion,
        previousVersions: allVersions.filter((v) => v.id !== currentVersion.id),
      } satisfies TemplateWithVersions;
    }),
  create: authdOrganizationProcedure
    .input(createTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      const slugExists = await db.query.template.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.organizationId, ctx.session.activeOrganization.id),
            eq(table.slug, input.slug)
          ),
      });

      if (slugExists) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Template slug already exists",
        });
      }

      return await db.transaction(async (tx) => {
        // Create the template
        const [template] = await tx
          .insert(schema.template)
          .values({
            organizationId: ctx.session.activeOrganization.id,
            name: input.name,
            slug: input.slug,
            category: input.category,
            status: "draft", // Always start as draft
          })
          .returning();

        // Create the first version
        const [templateVersion] = await tx
          .insert(schema.templateVersion)
          .values({
            templateId: template.id,
            version: 1,
            schema: input.schema,
          })
          .returning();

        // Create channel versions
        const channelVersionsData = input.channelVersions.map((cv) => ({
          templateVersionId: templateVersion.id,
          channel: cv.channel,
          content: cv.content,
        }));

        const channelVersions = await tx
          .insert(schema.templateChannelVersion)
          .values(channelVersionsData)
          .returning();

        // Update template to set current version
        await tx
          .update(schema.template)
          .set({ currentVersionId: templateVersion.id })
          .where(eq(schema.template.id, template.id));

        return {
          ...template,
          currentVersion: {
            ...templateVersion,
            channelVersions,
          },
        };
      });
    }),

  update: authdOrganizationProcedure
    .input(updateTemplateSchema)
    .mutation(async ({ ctx, input }) => {
      const { id, ...updateData } = input;

      // Verify template belongs to organization
      const existingTemplate = await db.query.template.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.id, id),
            eq(table.organizationId, ctx.session.activeOrganization.id)
          ),
        with: {
          currentVersion: {
            with: {
              channelVersions: true,
            },
          },
        },
      });

      if (!existingTemplate) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Template not found",
        });
      }

      // Check slug uniqueness if slug is being updated
      if (updateData.slug && updateData.slug !== existingTemplate.slug) {
        const slugExists = await db.query.template.findFirst({
          where: (table, { eq, and }) =>
            and(
              eq(table.organizationId, ctx.session.activeOrganization.id),
              eq(table.slug, updateData.slug as string)
            ),
        });

        if (slugExists) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Template slug already exists",
          });
        }
      }

      return await db.transaction(async (tx) => {
        // Update template metadata
        const templateUpdateFields: any = {};
        if (updateData.name) templateUpdateFields.name = updateData.name;
        if (updateData.slug) templateUpdateFields.slug = updateData.slug;
        if (updateData.category)
          templateUpdateFields.category = updateData.category;
        if (updateData.status) templateUpdateFields.status = updateData.status;

        if (Object.keys(templateUpdateFields).length > 0) {
          await tx
            .update(schema.template)
            .set(templateUpdateFields)
            .where(eq(schema.template.id, id));
        }

        // If schema or channel versions are updated, create a new version
        if (updateData.schema || updateData.channelVersions) {
          const currentVersion = existingTemplate.currentVersion;
          const nextVersion = (currentVersion?.version || 0) + 1;

          // Create new version
          const [newTemplateVersion] = await tx
            .insert(schema.templateVersion)
            .values({
              templateId: id,
              version: nextVersion,
              schema: updateData.schema
                ? SuperJSON.parse(updateData.schema)
                : currentVersion?.schema,
            })
            .returning();

          // Create new channel versions if provided
          if (updateData.channelVersions) {
            const channelVersionsData = updateData.channelVersions.map(
              (cv) => ({
                templateVersionId: newTemplateVersion.id,
                channel: cv.channel,
                content: cv.content,
              })
            );

            await tx
              .insert(schema.templateChannelVersion)
              .values(channelVersionsData);
          }

          // Update template to point to new current version
          await tx
            .update(schema.template)
            .set({ currentVersionId: newTemplateVersion.id })
            .where(eq(schema.template.id, id));
        }

        // Return updated template with the same structure as getBySlug
        const updatedTemplate = await tx.query.template.findFirst({
          where: (table, { eq }) => eq(table.id, id),
          with: {
            currentVersion: {
              with: {
                channelVersions: true,
              },
            },
          },
        });

        if (!updatedTemplate) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to retrieve updated template",
          });
        }

        // Fetch all versions separately to avoid relation ambiguity
        const allVersions = await tx.query.templateVersion.findMany({
          where: (table, { eq }) => eq(table.templateId, id),
          with: {
            channelVersions: true,
          },
          orderBy: (table, { desc }) => [desc(table.version)],
        });

        // Transform to TemplateWithVersions structure
        const { currentVersion, ...templateBase } = updatedTemplate;

        if (!currentVersion) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Template has no current version",
          });
        }

        return {
          ...templateBase,
          currentVersion,
          previousVersions: allVersions.filter(
            (v) => v.id !== currentVersion.id
          ),
        } satisfies TemplateWithVersions;
      });
    }),

  // Preview a React Email template (server-side rendering)
  preview: authdOrganizationProcedure
    .input(
      z.object({
        props: z.record(z.string(), z.any()),
        template: channelContentSchema,
      })
    )
    .mutation(async ({ input: { props, template } }) => {
      try {
        const result = await renderEmailServer({
          ...template.content,
          props: props || {},
        });

        if (result.error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: result.error.message,
            cause: result.error.details,
          });
        }

        return result.data;
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Failed to render React Email template: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    }),
});
