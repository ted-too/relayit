import { db, queueMessage, schema } from "@repo/api/db";
import { betterAuthApiKey } from "@repo/api/server/lib/auth/handler";
import {
  findOrCreateContact,
  findProviderIdentity,
} from "@repo/api/server/routes/send/utils";
import { logger } from "@repo/api/utils";
import { buildSendRawSchema } from "@repo/shared/providers";
import { Elysia, status } from "elysia";

export const rawRoutes = new Elysia({ prefix: "/raw" })
  .use(betterAuthApiKey)
  .post(
    "/email",
    async ({ body, organization, apiKeyId }) => {
      try {
        const newMessage = await db.transaction(async (tx) => {
          const contact = await findOrCreateContact({
            dbOrTx: tx,
            organizationId: organization.id,
            identifier: body.to,
            channel: "email",
            contactData: body.contact,
          });

          const providerIdentityResult = await findProviderIdentity({
            dbOrTx: tx,
            organizationId: organization.id,
            channel: "email",
            fromIdentifier: body.from,
          });

          if (!providerIdentityResult.success) {
            return providerIdentityResult;
          }

          const providerIdentity = providerIdentityResult.data;

          const [message] = await tx
            .insert(schema.message)
            .values({
              appSlug: body.app,
              appEnvironment: body.appEnvironment,
              apiKeyId,
              contactId: contact.id,
              channel: "email",
              payload: body.payload,
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

          return { success: true as const, message, messageEvent };
        });

        if (!newMessage.success) {
          return status(newMessage.status, {
            message: newMessage.message,
          });
        }

        await queueMessage(newMessage.messageEvent.id);

        return status(201, {
          id: newMessage.message.id,
          status: "queued",
        });
      } catch (error) {
        logger.error(error, "Failed to process and send raw email");

        return status(500, {
          message: `Failed to process send request: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    },
    {
      auth: true,
      body: buildSendRawSchema("email"),
    }
  );
