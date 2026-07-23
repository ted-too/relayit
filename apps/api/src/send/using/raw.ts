import { db, queueMessage, schema } from "@repo/shared/db";
import { buildSendRawSchema } from "@repo/shared/providers";
import { logger } from "@repo/shared/utils";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import {
  cleanupStoredAttachments,
  createMessageId,
  ingestAttachments,
} from "@/send/attachments";
import type { ApiKeyContext } from "@/send/middleware";
import { errorResponseSchema, successResponseSchema } from "@/send/schemas";
import { findOrCreateContact, findProviderIdentity } from "@/send/utils";

export const sendRawRouter = new Hono<{ Variables: ApiKeyContext }>().post(
  "/email",
  describeRoute({
    description: "Send an email",
    tags: ["email"],
    responses: {
      201: {
        description: "Successful response",
        content: {
          "application/json": {
            schema: resolver(successResponseSchema),
          },
        },
      },
      400: {
        description: "Bad request",
        content: {
          "application/json": {
            schema: resolver(errorResponseSchema),
          },
        },
      },
      404: {
        description: "Not found",
        content: {
          "application/json": {
            schema: resolver(errorResponseSchema),
          },
        },
      },
      500: {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: resolver(errorResponseSchema),
          },
        },
      },
    },
  }),
  zValidator("json", buildSendRawSchema("email")),
  async (c) => {
    const body = c.req.valid("json");
    const organization = c.get("organization");
    const apiKeyId = c.get("apiKeyId");
    const messageId = createMessageId();
    let storedAttachments: Awaited<ReturnType<typeof ingestAttachments>>;
    let persisted = false;

    try {
      storedAttachments = await ingestAttachments({
        organizationId: organization.id,
        messageId,
        attachments: body.attachments,
      });

      const payload = {
        ...body.payload,
        ...(storedAttachments ? { attachments: storedAttachments } : {}),
      };

      const newMessage = await db.transaction(async (tx) => {
        const contact = await findOrCreateContact({
          dbOrTx: tx,
          organizationId: organization.id,
          identifier: body.to,
          channel: "email",
          contactData: body.contact,
        });

        const providerIdentity = await findProviderIdentity({
          dbOrTx: tx,
          organizationId: organization.id,
          channel: "email",
          fromIdentifier: body.from,
        });

        const [message] = await tx
          .insert(schema.message)
          .values({
            id: messageId,
            appSlug: body.app,
            appEnvironment: body.appEnvironment,
            apiKeyId,
            contactId: contact.id,
            channel: "email",
            payload,
            source: "api",
          })
          .returning();

        const [messageEvent] = await tx
          .insert(schema.messageEvent)
          .values({
            messageId: message.id,
            status: "queued",
            attemptNumber: 1,
            identityId: providerIdentity.id,
          })
          .returning();

        return { message, messageEvent };
      });

      persisted = true;
      await queueMessage(newMessage.messageEvent.id);

      return c.json(
        {
          id: newMessage.message.id,
          status: "queued",
        },
        201
      );
    } catch (error) {
      if (!persisted) {
        await cleanupStoredAttachments(storedAttachments);
      }

      if (error instanceof HTTPException) {
        throw error;
      }

      logger.error(error, "Failed to process and send raw email");

      throw new HTTPException(500, {
        message: `Failed to process send request: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }
);
