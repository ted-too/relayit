import {
  findOrUpsertContact,
  normalizeContactEmail,
} from "@repo/api/contacts/contact";
import {
  decodeContactCursor,
  encodeContactCursor,
} from "@repo/api/contacts/cursor";
import { db, schema } from "@repo/api/db";
import { emitWebhookEvent } from "@repo/api/messages/webhooks";
import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import { apiRedis } from "@repo/api/server/lib/redis";
import { findOrCreateAppEnvironment } from "@repo/api/tenancy/app-environment";
import {
  contactIdParamsSchema,
  listContactsQuerySchema,
  updateContactBodySchema,
  upsertContactBodySchema,
} from "@repo/api/validators/routes/projects/contacts";
import { and, asc, eq, gt, isNull, or } from "drizzle-orm";
import { Elysia, status } from "elysia";

const DEFAULT_LIST_LIMIT = 50;

async function findContactInOrganization(
  contactId: string,
  organizationId: string
) {
  const row = await db.query.contact.findFirst({
    where: (table, { eq: equals }) => equals(table.id, contactId),
    with: { appEnvironment: true },
  });

  if (!row || row.appEnvironment.organizationId !== organizationId) {
    return null;
  }

  return row;
}

async function findAppEnvironmentId({
  organizationId,
  app,
  environment,
}: {
  organizationId: string;
  app?: string | null;
  environment?: string | null;
}) {
  const appValue = app ?? null;
  const environmentValue = environment ?? null;

  const existing = await db.query.organizationAppEnvironment.findFirst({
    where: (table, { eq: equals, and: andFn, isNull: isNullFn }) =>
      andFn(
        equals(table.organizationId, organizationId),
        appValue ? equals(table.app, appValue) : isNullFn(table.app),
        environmentValue
          ? equals(table.environment, environmentValue)
          : isNullFn(table.environment)
      ),
    columns: { id: true },
  });

  return existing?.id ?? null;
}

export const contactsRoutes = new Elysia({ prefix: "/contacts" })
  .use(betterAuthOrganization)
  .guard({
    organization: true,
    auth: true,
  })
  .get(
    "/",
    async ({ query, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { contact: ["read"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to read Contacts");
      }

      const limit = query.limit ?? DEFAULT_LIST_LIMIT;
      const appEnvironmentId = await findAppEnvironmentId({
        organizationId: organization.id,
        app: query.app,
        environment: query.environment,
      });

      if (!appEnvironmentId) {
        return { items: [], nextCursor: null };
      }

      const filters = [
        eq(schema.contact.organizationAppEnvironmentId, appEnvironmentId),
        isNull(schema.contact.deletedAt),
      ];

      if (query.cursor) {
        const decoded = decodeContactCursor(query.cursor);
        if (!decoded) {
          return status(400, {
            code: "invalid_cursor",
            message: "Invalid list cursor",
          });
        }

        const cursorCreatedAt = new Date(decoded.createdAt);
        const afterCursor = or(
          gt(schema.contact.createdAt, cursorCreatedAt),
          and(
            eq(schema.contact.createdAt, cursorCreatedAt),
            gt(schema.contact.id, decoded.id)
          )
        );
        if (afterCursor) {
          filters.push(afterCursor);
        }
      }

      const rows = await db
        .select()
        .from(schema.contact)
        .where(and(...filters))
        .orderBy(asc(schema.contact.createdAt), asc(schema.contact.id))
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      const last = items.at(-1);

      return {
        items,
        nextCursor: hasMore && last ? encodeContactCursor(last) : null,
      };
    },
    { query: listContactsQuerySchema }
  )
  .get(
    "/:id",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { contact: ["read"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to read Contacts");
      }

      const contact = await findContactInOrganization(
        params.id,
        organization.id
      );

      if (!contact) {
        return status(404, {
          code: "contact_not_found",
          message: "Contact not found in this Project",
        });
      }

      return contact;
    },
    { params: contactIdParamsSchema }
  )
  .post(
    "/",
    async ({ body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { contact: ["create"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to create Contacts");
      }

      const appEnvironment = await findOrCreateAppEnvironment({
        db,
        organizationId: organization.id,
        app: body.app ?? null,
        environment: body.environment ?? null,
      });

      const contact = await findOrUpsertContact({
        db,
        organizationAppEnvironmentId: appEnvironment.id,
        channel: "email",
        identifier: { email: body.email },
        data: {
          firstName: body.firstName,
          lastName: body.lastName,
          properties: body.properties,
        },
      });

      await emitWebhookEvent({
        db,
        redis: apiRedis,
        organizationId: organization.id,
        type: "contact.updated",
        payload: {
          contact_id: contact.id,
          email: contact.email,
          source: "contact.api",
        },
      });

      return contact;
    },
    { body: upsertContactBodySchema }
  )
  .patch(
    "/:id",
    async ({ params, body, organization, request }) => {
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
        params.id,
        organization.id
      );

      if (!contact || contact.deletedAt) {
        return status(404, {
          code: "contact_not_found",
          message: "Contact not found in this Project",
        });
      }

      const updates: {
        email?: string;
        firstName?: string | null;
        lastName?: string | null;
        properties?: typeof contact.properties;
        updatedAt: Date;
      } = { updatedAt: new Date() };

      if (body.email !== undefined) {
        const email = normalizeContactEmail(body.email);
        if (email !== contact.email) {
          const collision = await db.query.contact.findFirst({
            where: (table, { eq: equals, and: andFn }) =>
              andFn(
                equals(
                  table.organizationAppEnvironmentId,
                  contact.organizationAppEnvironmentId
                ),
                equals(table.email, email)
              ),
            columns: { id: true },
          });

          if (collision && collision.id !== contact.id) {
            return status(409, {
              code: "contact_email_conflict",
              message:
                "Another Contact in this App Environment already uses that email",
            });
          }

          updates.email = email;
        }
      }

      if (body.firstName !== undefined) {
        updates.firstName = body.firstName;
      }

      if (body.lastName !== undefined) {
        updates.lastName = body.lastName;
      }

      if (body.properties !== undefined) {
        if (body.properties === null) {
          updates.properties = null;
        } else {
          updates.properties = {
            ...(contact.properties ?? {}),
            ...body.properties,
          };
        }
      }

      const [updated] = await db
        .update(schema.contact)
        .set(updates)
        .where(eq(schema.contact.id, contact.id))
        .returning();

      if (updated) {
        await emitWebhookEvent({
          db,
          redis: apiRedis,
          organizationId: organization.id,
          type: "contact.updated",
          payload: {
            contact_id: updated.id,
            email: updated.email,
            source: "contact.api",
          },
        });
      }

      return updated;
    },
    { params: contactIdParamsSchema, body: updateContactBodySchema }
  )
  .delete(
    "/:id",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: { contact: ["delete"] },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to delete Contacts");
      }

      const contact = await findContactInOrganization(
        params.id,
        organization.id
      );

      if (!contact) {
        return status(404, {
          code: "contact_not_found",
          message: "Contact not found in this Project",
        });
      }

      if (contact.deletedAt) {
        return contact;
      }

      const [updated] = await db
        .update(schema.contact)
        .set({
          deletedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(schema.contact.id, contact.id))
        .returning();

      return updated;
    },
    { params: contactIdParamsSchema }
  );
