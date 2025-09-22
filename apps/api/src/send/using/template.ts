import { db, queueMessage, schema } from "@repo/shared/db";
import { buildSendTemplateSchema } from "@repo/shared/providers";
import { logger } from "@repo/shared/utils";
import { renderEmailServer } from "@repo/template-render/react-email";
import Ajv from "ajv/dist/2020";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { describeRoute, resolver, validator as zValidator } from "hono-openapi";
import type { ApiKeyContext } from "@/send/middleware";
import { errorResponseSchema, successResponseSchema } from "@/send/schemas";
import {
  findActiveTemplate,
  findOrCreateContact,
  findProviderIdentity,
} from "@/send/utils";


const ajv = new Ajv({
  allowUnionTypes: true,
  strict: false,
  removeAdditional: false,
  useDefaults: true,
  coerceTypes: false,
});

export const sendTemplateRouter = new Hono<{ Variables: ApiKeyContext }>().post(
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
  zValidator("json", buildSendTemplateSchema("email")),
  async (c) => {
    const body = c.req.valid("json");
    const organization = c.get("organization");
    const apiKeyId = c.get("apiKeyId");

    try {
      const { templateVersion, channelVersion } = await findActiveTemplate({
        dbOrTx: db,
        organizationId: organization.id,
        templateSlug: body.template.slug,
        channel: "email",
      });

      // Validate props against template schema using AJV
      if (templateVersion.schema) {
        const validate = ajv.compile(templateVersion.schema);
        const valid = validate(body.template.props);

        if (!valid) {
          throw new HTTPException(400, {
            message: `Template props validation failed: ${ajv.errorsText(validate.errors)}`,
          });
        }
      }

      // Render the template
      const renderResult = await renderEmailServer({
        ...channelVersion.content,
        props: body.template.props,
      });

      if (renderResult.error) {
        throw new HTTPException(400, {
          message: `Template rendering failed: ${renderResult.error.message}`,
        });
      }

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
            appSlug: body.app,
            appEnvironment: body.appEnvironment,
            apiKeyId,
            contactId: contact.id,
            channel: "email",
            payload: renderResult.data,
            source: "template",
          })
          .returning();

        // Link message to template version
        await tx.insert(schema.messageTemplate).values({
          messageId: message.id,
          templateVersionId: templateVersion.id,
          templateProps: body.template.props,
        });

        // Create initial message event for worker processing
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

      await queueMessage(newMessage.messageEvent.id);

      return c.json(
        {
          id: newMessage.message.id,
          status: "queued",
        },
        201
      );
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }

      logger.error(error, "Failed to process and send template email");

      throw new HTTPException(500, {
        message: `Failed to process template send request: ${error instanceof Error ? error.message : "Unknown error"}`,
      });
    }
  }
);
