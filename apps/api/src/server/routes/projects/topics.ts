import { db, schema } from "@repo/api/db";
import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import {
  createTopicBodySchema,
  topicIdParamsSchema,
} from "@repo/api/validators/routes/projects/topics";
import { and, eq, isNull } from "drizzle-orm";
import { Elysia, status } from "elysia";

export const topicsRoutes = new Elysia({ prefix: "/topics" })
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
        permissions: { topic: ["read"] },
      },
    });

    if (!hasPermission) {
      return status(403, "You do not have permission to read Topics");
    }

    return db.query.topic.findMany({
      where: (table, { eq }) => eq(table.organizationId, organization.id),
      orderBy: (table, { asc }) => [asc(table.createdAt)],
    });
  })
  .post(
    "/",
    async ({ body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { topic: ["create"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to create Topics");
      }

      const [created] = await db
        .insert(schema.topic)
        .values({
          organizationId: organization.id,
          name: body.name,
        })
        .returning();

      return created;
    },
    { body: createTopicBodySchema }
  )
  .post(
    "/:id/archive",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { topic: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to archive Topics");
      }

      const existing = await db.query.topic.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.id, params.id),
            eq(table.organizationId, organization.id)
          ),
      });

      if (!existing) {
        return status(404, "Topic not found");
      }

      if (existing.archivedAt) {
        return existing;
      }

      const [archived] = await db
        .update(schema.topic)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(schema.topic.id, existing.id),
            eq(schema.topic.organizationId, organization.id),
            isNull(schema.topic.archivedAt)
          )
        )
        .returning();

      return archived ?? existing;
    },
    { params: topicIdParamsSchema }
  );
