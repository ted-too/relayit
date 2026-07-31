import { db, schema } from "@repo/api/db";
import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import {
  addSegmentMembersBodySchema,
  createSegmentBodySchema,
  segmentIdParamsSchema,
  segmentMemberParamsSchema,
} from "@repo/api/validators/routes/projects/segments";
import { and, eq, isNull } from "drizzle-orm";
import { Elysia, status } from "elysia";

function findSegmentInOrganization(segmentId: string, organizationId: string) {
  return db.query.segment.findFirst({
    where: (table, { eq, and }) =>
      and(eq(table.id, segmentId), eq(table.organizationId, organizationId)),
  });
}

export const segmentsRoutes = new Elysia({ prefix: "/segments" })
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
        permissions: { segment: ["read"] },
      },
    });

    if (!hasPermission) {
      return status(403, "You do not have permission to read Segments");
    }

    return db.query.segment.findMany({
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
          permissions: { segment: ["create"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to create Segments");
      }

      const [created] = await db
        .insert(schema.segment)
        .values({
          organizationId: organization.id,
          name: body.name,
        })
        .returning();

      return created;
    },
    { body: createSegmentBodySchema }
  )
  .post(
    "/:id/archive",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { segment: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to archive Segments");
      }

      const existing = await findSegmentInOrganization(
        params.id,
        organization.id
      );

      if (!existing) {
        return status(404, "Segment not found");
      }

      if (existing.archivedAt) {
        return existing;
      }

      const [archived] = await db
        .update(schema.segment)
        .set({ archivedAt: new Date() })
        .where(
          and(
            eq(schema.segment.id, existing.id),
            eq(schema.segment.organizationId, organization.id),
            isNull(schema.segment.archivedAt)
          )
        )
        .returning();

      return archived ?? existing;
    },
    { params: segmentIdParamsSchema }
  )
  .get(
    "/:id/members",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { segment: ["read"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to read Segments");
      }

      const existing = await findSegmentInOrganization(
        params.id,
        organization.id
      );

      if (!existing) {
        return status(404, "Segment not found");
      }

      return db.query.segmentMember.findMany({
        where: (table, { eq }) => eq(table.segmentId, existing.id),
        with: {
          contact: true,
        },
      });
    },
    { params: segmentIdParamsSchema }
  )
  .post(
    "/:id/members",
    async ({ params, body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { segment: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to update Segments");
      }

      const existing = await findSegmentInOrganization(
        params.id,
        organization.id
      );

      if (!existing) {
        return status(404, "Segment not found");
      }

      if (existing.archivedAt) {
        return status(422, {
          code: "segment_archived",
          message: "Cannot add members to an archived Segment",
        });
      }

      const contacts = await db.query.contact.findMany({
        where: (table, { and, inArray, isNull }) =>
          and(inArray(table.id, body.contactIds), isNull(table.deletedAt)),
        with: {
          appEnvironment: true,
        },
      });

      const inProject = contacts.filter(
        (c) => c.appEnvironment.organizationId === organization.id
      );

      if (inProject.length !== body.contactIds.length) {
        return status(422, {
          code: "invalid_segment_members",
          message:
            "Every contactId must refer to an active Contact in this Project",
        });
      }

      await db
        .insert(schema.segmentMember)
        .values(
          inProject.map((c) => ({
            segmentId: existing.id,
            contactId: c.id,
          }))
        )
        .onConflictDoNothing();

      return db.query.segmentMember.findMany({
        where: (table, { eq }) => eq(table.segmentId, existing.id),
      });
    },
    {
      params: segmentIdParamsSchema,
      body: addSegmentMembersBodySchema,
    }
  )
  .delete(
    "/:id/members/:contactId",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { segment: ["update"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to update Segments");
      }

      const existing = await findSegmentInOrganization(
        params.id,
        organization.id
      );

      if (!existing) {
        return status(404, "Segment not found");
      }

      await db
        .delete(schema.segmentMember)
        .where(
          and(
            eq(schema.segmentMember.segmentId, existing.id),
            eq(schema.segmentMember.contactId, params.contactId)
          )
        );

      return { segmentId: existing.id, contactId: params.contactId };
    },
    { params: segmentMemberParamsSchema }
  );
