import { db, schema } from "@repo/api/db";
import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import {
  createSuppressionBodySchema,
  suppressionContactIdParamsSchema,
} from "@repo/api/validators/routes/projects/suppressions";
import { and, eq, isNotNull } from "drizzle-orm";
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

export const suppressionsRoutes = new Elysia({ prefix: "/suppressions" })
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
        permissions: { contact: ["read"] },
      },
    });

    if (!hasPermission) {
      return status(403, "You do not have permission to read Suppressions");
    }

    const environments = await db.query.organizationAppEnvironment.findMany({
      where: (table, { eq }) => eq(table.organizationId, organization.id),
      columns: { id: true },
    });

    const environmentIds = environments.map((e) => e.id);
    if (environmentIds.length === 0) {
      return [];
    }

    return db.query.contact.findMany({
      where: (table, { and, inArray, isNotNull }) =>
        and(
          inArray(table.organizationAppEnvironmentId, environmentIds),
          isNotNull(table.suppressionSeverity)
        ),
    });
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

      const [updated] = await db
        .update(schema.contact)
        .set({
          suppressionSeverity: body.severity,
          suppressionReason: "manual",
          suppressedAt: new Date(),
        })
        .where(eq(schema.contact.id, contact.id))
        .returning();

      return updated;
    },
    { body: createSuppressionBodySchema }
  )
  .delete(
    "/:contactId",
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

      if (!contact.suppressionSeverity) {
        return status(404, {
          code: "suppression_not_found",
          message: "Contact is not suppressed",
        });
      }

      const [updated] = await db
        .update(schema.contact)
        .set({
          suppressionSeverity: null,
          suppressionReason: null,
          suppressedAt: null,
        })
        .where(
          and(
            eq(schema.contact.id, contact.id),
            isNotNull(schema.contact.suppressionSeverity)
          )
        )
        .returning();

      return updated;
    },
    { params: suppressionContactIdParamsSchema }
  );
