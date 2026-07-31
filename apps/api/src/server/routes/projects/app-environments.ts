import { db, schema } from "@repo/api/db";
import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import { appEnvironmentIdParamsSchema } from "@repo/api/validators/routes/projects/app-environments";
import { and, eq } from "drizzle-orm";
import { Elysia, status } from "elysia";

export const appEnvironmentsRoutes = new Elysia({
  prefix: "/appEnvironments",
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
        permissions: {
          appEnvironment: ["read"],
        },
      },
    });

    if (!hasPermission) {
      return status(403, "You do not have permission to read App Environments");
    }

    return db.query.organizationAppEnvironment.findMany({
      where: (table, { eq }) => eq(table.organizationId, organization.id),
      orderBy: (table, { asc }) => [asc(table.createdAt)],
    });
  })
  .delete(
    "/:id",
    async ({ params, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: {
            appEnvironment: ["delete"],
          },
        },
      });

      if (!hasPermission) {
        return status(
          403,
          "You do not have permission to delete App Environments"
        );
      }

      const existing = await db.query.organizationAppEnvironment.findFirst({
        where: (table, { eq, and }) =>
          and(
            eq(table.id, params.id),
            eq(table.organizationId, organization.id)
          ),
      });

      if (!existing) {
        return status(404, "App Environment not found");
      }

      if (existing.app === null && existing.environment === null) {
        return status(422, {
          code: "default_app_environment_undeletable",
          message:
            "The Project default App Environment (no app or environment) cannot be deleted.",
        });
      }

      await db
        .delete(schema.organizationAppEnvironment)
        .where(
          and(
            eq(schema.organizationAppEnvironment.id, existing.id),
            eq(
              schema.organizationAppEnvironment.organizationId,
              organization.id
            )
          )
        );

      return { id: existing.id };
    },
    {
      params: appEnvironmentIdParamsSchema,
    }
  );
