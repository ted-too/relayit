import { db, schema } from "@repo/api/db";
import {
  enqueueWebhookDelivery,
  generateWebhookSigningSecret,
  WEBHOOK_DUAL_SECRET_WINDOW_MS,
} from "@repo/api/messages/webhooks";
import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import { apiRedis } from "@repo/api/server/lib/redis";
import {
  createWebhookEndpointBodySchema,
  updateWebhookEndpointBodySchema,
  webhookEndpointIdParamsSchema,
  webhookEventDeliveryIdParamsSchema,
} from "@repo/api/validators/routes/projects/webhook-endpoints";
import { and, eq } from "drizzle-orm";
import { Elysia, status } from "elysia";

function publicEndpoint(row: typeof schema.webhookEndpoint.$inferSelect) {
  const { signingSecret: _secret, previousSigningSecret: _prev, ...rest } = row;
  return {
    ...rest,
    hasPreviousSecret: Boolean(row.previousSigningSecret),
    previousSecretExpiresAt: row.previousSecretExpiresAt,
  };
}

export const webhookEndpointsRoutes = new Elysia({
  prefix: "/webhookEndpoints",
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
        permissions: { webhookEndpoint: ["read"] },
      },
    });

    if (!hasPermission) {
      return status(
        403,
        "You do not have permission to read Webhook Endpoints"
      );
    }

    const rows = await db.query.webhookEndpoint.findMany({
      where: (table, { eq: equals }) =>
        equals(table.organizationId, organization.id),
      orderBy: (table, { asc }) => [asc(table.createdAt)],
    });

    return rows.map(publicEndpoint);
  })
  .post(
    "/",
    async ({ body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { webhookEndpoint: ["create"] },
        },
      });

      if (!hasPermission) {
        return status(
          403,
          "You do not have permission to create Webhook Endpoints"
        );
      }

      const signingSecret = generateWebhookSigningSecret();
      const [created] = await db
        .insert(schema.webhookEndpoint)
        .values({
          organizationId: organization.id,
          url: body.url,
          eventTypes: body.eventTypes,
          tagFilter: body.tagFilter,
          enabled: body.enabled,
          signingSecret,
        })
        .returning();

      return {
        ...publicEndpoint(created),
        signingSecret,
      };
    },
    { body: createWebhookEndpointBodySchema }
  )
  .get(
    "/:id",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { webhookEndpoint: ["read"] },
        },
      });

      if (!hasPermission) {
        return status(
          403,
          "You do not have permission to read Webhook Endpoints"
        );
      }

      const row = await db.query.webhookEndpoint.findFirst({
        where: (table, { eq: equals, and: combine }) =>
          combine(
            equals(table.id, params.id),
            equals(table.organizationId, organization.id)
          ),
      });

      if (!row) {
        return status(404, "Webhook Endpoint not found");
      }

      return publicEndpoint(row);
    },
    { params: webhookEndpointIdParamsSchema }
  )
  .patch(
    "/:id",
    async ({ params, body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { webhookEndpoint: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(
          403,
          "You do not have permission to update Webhook Endpoints"
        );
      }

      const existing = await db.query.webhookEndpoint.findFirst({
        where: (table, { eq: equals, and: combine }) =>
          combine(
            equals(table.id, params.id),
            equals(table.organizationId, organization.id)
          ),
      });

      if (!existing) {
        return status(404, "Webhook Endpoint not found");
      }

      const wasDisabled = !existing.enabled;
      const [updated] = await db
        .update(schema.webhookEndpoint)
        .set({
          ...(body.url === undefined ? {} : { url: body.url }),
          ...(body.eventTypes === undefined
            ? {}
            : { eventTypes: body.eventTypes }),
          ...(body.tagFilter === undefined
            ? {}
            : { tagFilter: body.tagFilter }),
          ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        })
        .where(eq(schema.webhookEndpoint.id, existing.id))
        .returning();

      if (wasDisabled && updated.enabled) {
        const held = await db.query.webhookEventDelivery.findMany({
          where: (table, { eq: equals, and: combine }) =>
            combine(
              equals(table.webhookEndpointId, updated.id),
              equals(table.status, "held")
            ),
        });

        for (const delivery of held) {
          await db
            .update(schema.webhookEventDelivery)
            .set({ status: "pending", nextAttemptAt: new Date() })
            .where(eq(schema.webhookEventDelivery.id, delivery.id));
          await enqueueWebhookDelivery(apiRedis, delivery.id);
        }
      }

      return publicEndpoint(updated);
    },
    {
      params: webhookEndpointIdParamsSchema,
      body: updateWebhookEndpointBodySchema,
    }
  )
  .post(
    "/:id/rotateSecret",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { webhookEndpoint: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(
          403,
          "You do not have permission to rotate Webhook Endpoint secrets"
        );
      }

      const existing = await db.query.webhookEndpoint.findFirst({
        where: (table, { eq: equals, and: combine }) =>
          combine(
            equals(table.id, params.id),
            equals(table.organizationId, organization.id)
          ),
      });

      if (!existing) {
        return status(404, "Webhook Endpoint not found");
      }

      const signingSecret = generateWebhookSigningSecret();
      const [updated] = await db
        .update(schema.webhookEndpoint)
        .set({
          previousSigningSecret: existing.signingSecret,
          previousSecretExpiresAt: new Date(
            Date.now() + WEBHOOK_DUAL_SECRET_WINDOW_MS
          ),
          signingSecret,
        })
        .where(eq(schema.webhookEndpoint.id, existing.id))
        .returning();

      return {
        ...publicEndpoint(updated),
        signingSecret,
      };
    },
    { params: webhookEndpointIdParamsSchema }
  )
  .post(
    "/:id/clearPreviousSecret",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { webhookEndpoint: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(
          403,
          "You do not have permission to update Webhook Endpoints"
        );
      }

      const [updated] = await db
        .update(schema.webhookEndpoint)
        .set({
          previousSigningSecret: null,
          previousSecretExpiresAt: null,
        })
        .where(
          and(
            eq(schema.webhookEndpoint.id, params.id),
            eq(schema.webhookEndpoint.organizationId, organization.id)
          )
        )
        .returning();

      if (!updated) {
        return status(404, "Webhook Endpoint not found");
      }

      return publicEndpoint(updated);
    },
    { params: webhookEndpointIdParamsSchema }
  )
  .delete(
    "/:id",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { webhookEndpoint: ["delete"] },
        },
      });

      if (!hasPermission) {
        return status(
          403,
          "You do not have permission to delete Webhook Endpoints"
        );
      }

      const [deleted] = await db
        .delete(schema.webhookEndpoint)
        .where(
          and(
            eq(schema.webhookEndpoint.id, params.id),
            eq(schema.webhookEndpoint.organizationId, organization.id)
          )
        )
        .returning({ id: schema.webhookEndpoint.id });

      if (!deleted) {
        return status(404, "Webhook Endpoint not found");
      }

      return { id: deleted.id };
    },
    { params: webhookEndpointIdParamsSchema }
  )
  .post(
    "/:id/deliveries/:deliveryId/replay",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { webhookEndpoint: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(
          403,
          "You do not have permission to replay Webhook Event Deliveries"
        );
      }

      const endpoint = await db.query.webhookEndpoint.findFirst({
        where: (table, { eq: equals, and: combine }) =>
          combine(
            equals(table.id, params.id),
            equals(table.organizationId, organization.id)
          ),
        columns: { id: true, enabled: true },
      });

      if (!endpoint) {
        return status(404, "Webhook Endpoint not found");
      }

      const delivery = await db.query.webhookEventDelivery.findFirst({
        where: (table, { eq: equals, and: combine }) =>
          combine(
            equals(table.id, params.deliveryId),
            equals(table.webhookEndpointId, endpoint.id)
          ),
      });

      if (!delivery) {
        return status(404, "Webhook Event Delivery not found");
      }

      if (!endpoint.enabled) {
        await db
          .update(schema.webhookEventDelivery)
          .set({ status: "held", nextAttemptAt: null, lastError: null })
          .where(eq(schema.webhookEventDelivery.id, delivery.id));
        return { id: delivery.id, status: "held" as const };
      }

      await db
        .update(schema.webhookEventDelivery)
        .set({
          status: "pending",
          nextAttemptAt: new Date(),
          lastError: null,
        })
        .where(eq(schema.webhookEventDelivery.id, delivery.id));

      await enqueueWebhookDelivery(apiRedis, delivery.id);
      return { id: delivery.id, status: "pending" as const };
    },
    { params: webhookEventDeliveryIdParamsSchema }
  );
