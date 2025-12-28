import { betterAuthApiKey } from "@repo/api/lib/auth-handler";
import {
  findActiveTemplate,
  findOrCreateContact,
  findProviderIdentity,
} from "@repo/api/routes/send/utils";
import { db, queueMessage, schema } from "@repo/shared/db";
import { buildSendTemplateSchema } from "@repo/shared/providers";
import { logger } from "@repo/shared/utils";
import { renderEmailServer } from "@repo/template-render/react-email";
import Ajv from "ajv/dist/2020";
import { Elysia, status } from "elysia";

const ajv = new Ajv({
  allowUnionTypes: true,
  strict: false,
  removeAdditional: false,
  useDefaults: true,
  coerceTypes: false,
});

export const templateRoutes = new Elysia({ prefix: "/template" })
  .use(betterAuthApiKey)
  .post(
    "/email",
    async ({ body, organization, apiKeyId }) => {
      const templateResult = await findActiveTemplate({
        dbOrTx: db,
        organizationId: organization.id,
        templateSlug: body.template.slug,
        channel: "email",
      });

      if (!templateResult.success) {
        return status(templateResult.status, {
          message: templateResult.message,
        });
      }

      const { templateVersion, channelVersion } = templateResult.data;

      if (templateVersion.schema) {
        const validate = ajv.compile(templateVersion.schema);
        const valid = validate(body.template.props);

        if (!valid) {
          return status(400, {
            message: `Template props validation failed: ${ajv.errorsText(validate.errors)}`,
          });
        }
      }

      const renderResult = await renderEmailServer({
        ...channelVersion.content,
        props: body.template.props,
      });

      if (renderResult.error) {
        return status(400, {
          message: `Template rendering failed: ${renderResult.error.message}`,
        });
      }

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
              payload: renderResult.data,
              source: "template",
            })
            .returning();

          await tx.insert(schema.messageTemplate).values({
            messageId: message.id,
            templateVersionId: templateVersion.id,
            templateProps: body.template.props,
          });

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
        logger.error(error, "Failed to process and send template email");

        return status(500, {
          message: `Failed to process template send request: ${error instanceof Error ? error.message : "Unknown error"}`,
        });
      }
    },
    {
      auth: true,
      body: buildSendTemplateSchema("email"),
    }
  );
