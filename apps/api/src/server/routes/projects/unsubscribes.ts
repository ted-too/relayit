import { db, schema } from "@repo/api/db";
import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import {
  createUnsubscribeBodySchema,
  deleteGlobalUnsubscribeParamsSchema,
  deleteTopicUnsubscribeParamsSchema,
} from "@repo/api/validators/routes/projects/unsubscribes";
import { and, eq } from "drizzle-orm";
import { Elysia, status } from "elysia";

async function findContactInOrganization(
  contactId: string,
  organizationId: string
) {
  const row = await db.query.contact.findFirst({
    where: (table, { eq }) => eq(table.id, contactId),
    with: { appEnvironment: true },
  });

  if (!row || row.appEnvironment.organizationId !== organizationId) {
    return null;
  }

  return row;
}

export const unsubscribesRoutes = new Elysia({ prefix: "/unsubscribes" })
  .use(betterAuthOrganization)
  .guard({
    organization: true,
    auth: true,
  })
  .post(
    "/",
    async ({ body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { contact: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to update Contacts");
      }

      const contact = await findContactInOrganization(
        body.contactId,
        organization.id
      );

      if (!contact || contact.deletedAt) {
        return status(404, {
          code: "contact_not_found",
          message: "Contact not found in this Project",
        });
      }

      if (body.allMarketing) {
        const [updated] = await db
          .update(schema.contact)
          .set({ unsubscribed: true })
          .where(eq(schema.contact.id, contact.id))
          .returning();

        return { contact: updated, topicId: null, allMarketing: true };
      }

      const topicId = body.topicId;
      if (!topicId) {
        return status(422, {
          code: "topic_id_required",
          message: "Provide topicId or set allMarketing to true",
        });
      }

      const topic = await db.query.topic.findFirst({
        where: (table, { eq, and }) =>
          and(eq(table.id, topicId), eq(table.organizationId, organization.id)),
      });

      if (!topic) {
        return status(404, "Topic not found");
      }

      await db
        .insert(schema.contactTopicUnsubscribe)
        .values({
          contactId: contact.id,
          topicId: topic.id,
        })
        .onConflictDoNothing();

      return {
        contactId: contact.id,
        topicId: topic.id,
        allMarketing: false,
      };
    },
    { body: createUnsubscribeBodySchema }
  )
  .delete(
    "/:contactId/topics/:topicId",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { contact: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to update Contacts");
      }

      const contact = await findContactInOrganization(
        params.contactId,
        organization.id
      );

      if (!contact) {
        return status(404, {
          code: "contact_not_found",
          message: "Contact not found in this Project",
        });
      }

      await db
        .delete(schema.contactTopicUnsubscribe)
        .where(
          and(
            eq(schema.contactTopicUnsubscribe.contactId, contact.id),
            eq(schema.contactTopicUnsubscribe.topicId, params.topicId)
          )
        );

      return {
        contactId: contact.id,
        topicId: params.topicId,
      };
    },
    { params: deleteTopicUnsubscribeParamsSchema }
  )
  .delete(
    "/:contactId/allMarketing",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { contact: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to update Contacts");
      }

      const contact = await findContactInOrganization(
        params.contactId,
        organization.id
      );

      if (!contact) {
        return status(404, {
          code: "contact_not_found",
          message: "Contact not found in this Project",
        });
      }

      const [updated] = await db
        .update(schema.contact)
        .set({ unsubscribed: false })
        .where(eq(schema.contact.id, contact.id))
        .returning();

      return { contact: updated, allMarketing: false };
    },
    { params: deleteGlobalUnsubscribeParamsSchema }
  );
