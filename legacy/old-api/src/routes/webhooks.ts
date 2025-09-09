import { authdProcedureWithOrg, router, verifyProject } from "@repo/api/trpc";
import { db, encrypt, redactedString, schema } from "@repo/db";
import {
  createWebhookEndpointSchema,
  updateWebhookEndpointSchema,
} from "@repo/shared";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";

export const webhookRouter = router({
  create: authdProcedureWithOrg
    .concat(verifyProject)
    .input(createWebhookEndpointSchema)
    .mutation(async ({ ctx, input }) => {
      const { project } = ctx;
      const validatedData = input;

      let secretToStore: string | null = null;
      if (validatedData.secret) {
        const encryptedSecret = encrypt(validatedData.secret);
        if (encryptedSecret.error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to encrypt secret",
          });
        }
        secretToStore = encryptedSecret.data;
      }

      const [newWebhook] = await db
        .insert(schema.webhookEndpoint)
        .values({
          projectId: project.id,
          url: validatedData.url,
          secret: secretToStore,
          eventTypes: validatedData.eventTypes,
          isActive: validatedData.isActive,
        })
        .returning();

      if (!newWebhook) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create webhook endpoint",
        });
      }

      const safeWebhook = {
        ...newWebhook,
        secret: newWebhook.secret ? redactedString : null,
      };

      return safeWebhook;
    }),
  list: authdProcedureWithOrg
    .concat(verifyProject)
    .input(z.object({}))
    .query(async ({ ctx }) => {
      const { project } = ctx;

      const webhooks = await db.query.webhookEndpoint.findMany({
        where: eq(schema.webhookEndpoint.projectId, project.id),
        orderBy: desc(schema.webhookEndpoint.createdAt),
      });

      const safeWebhooks = webhooks.map((webhook) => ({
        ...webhook,
        secret: webhook.secret ? redactedString : null,
      }));

      return safeWebhooks;
    }),
  getById: authdProcedureWithOrg
    .concat(verifyProject)
    .input(z.object({ webhookId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { project } = ctx;
      const { webhookId } = input;

      const webhook = await db.query.webhookEndpoint.findFirst({
        where: and(
          eq(schema.webhookEndpoint.id, webhookId),
          eq(schema.webhookEndpoint.projectId, project.id)
        ),
      });

      if (!webhook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook endpoint not found",
        });
      }

      const safeWebhook = {
        ...webhook,
        secret: webhook.secret ? redactedString : null,
      };

      return safeWebhook;
    }),
  update: authdProcedureWithOrg
    .concat(verifyProject)
    .input(
      z.object({ webhookId: z.string() }).merge(updateWebhookEndpointSchema)
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = ctx;
      const { webhookId, ...validatedData } = input;

      const existingWebhook = await db.query.webhookEndpoint.findFirst({
        columns: { id: true },
        where: and(
          eq(schema.webhookEndpoint.id, webhookId),
          eq(schema.webhookEndpoint.projectId, project.id)
        ),
      });

      if (!existingWebhook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook endpoint not found for this project",
        });
      }

      const updatePayload: Partial<typeof schema.webhookEndpoint.$inferInsert> =
        {};
      if (validatedData.url) {
        updatePayload.url = validatedData.url;
      }
      if (validatedData.eventTypes) {
        updatePayload.eventTypes = validatedData.eventTypes;
      }
      if (validatedData.isActive !== undefined) {
        updatePayload.isActive = validatedData.isActive;
      }

      if (validatedData.secret !== undefined) {
        if (validatedData.secret === null || validatedData.secret === "") {
          updatePayload.secret = null;
        } else {
          const encryptedSecret = encrypt(validatedData.secret);
          if (encryptedSecret.error) {
            throw new TRPCError({
              code: "INTERNAL_SERVER_ERROR",
              message: "Failed to encrypt secret",
            });
          }
          updatePayload.secret = encryptedSecret.data;
        }
      }

      if (Object.keys(updatePayload).length === 0) {
        const fullExisting = await db.query.webhookEndpoint.findFirst({
          where: eq(schema.webhookEndpoint.id, webhookId),
        });
        if (!fullExisting) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Webhook not found",
          });
        }
        return {
          ...fullExisting,
          secret: fullExisting.secret ? redactedString : null,
        };
      }

      const [updatedWebhook] = await db
        .update(schema.webhookEndpoint)
        .set(updatePayload)
        .where(
          and(
            eq(schema.webhookEndpoint.id, webhookId),
            eq(schema.webhookEndpoint.projectId, project.id)
          )
        )
        .returning();

      if (!updatedWebhook) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Webhook endpoint not found during update",
        });
      }

      const safeWebhook = {
        ...updatedWebhook,
        secret: updatedWebhook.secret ? redactedString : null,
      };

      return safeWebhook;
    }),
  delete: authdProcedureWithOrg
    .concat(verifyProject)
    .input(z.object({ webhookId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = ctx;
      const { webhookId } = input;

      const { rowCount } = await db
        .delete(schema.webhookEndpoint)
        .where(
          and(
            eq(schema.webhookEndpoint.id, webhookId),
            eq(schema.webhookEndpoint.projectId, project.id)
          )
        );

      if (rowCount === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "Webhook endpoint not found or already deleted for this project",
        });
      }

      return { message: "Webhook deleted successfully" };
    }),
});
