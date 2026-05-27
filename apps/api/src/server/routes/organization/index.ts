import { schema } from "@repo/api/db";
import { auth } from "@repo/api/server/lib/auth";
import {
  activeOrganization,
  betterAuth,
} from "@repo/api/server/lib/auth/handler";
import { generateDbSlug } from "@repo/api/server/lib/slug";
import { apiKeysRoutes } from "@repo/api/server/routes/organization/api-keys";
import { integrationsRoutes } from "@repo/api/server/routes/organization/integrations";
import { createOrganizationSchema } from "@repo/shared/forms";
import { Elysia, status } from "elysia";
import z from "zod";

export const organizationRoutes = new Elysia({ prefix: "/organization" })
  .use(betterAuth)
  .use(activeOrganization)
  .post(
    "/create",
    async ({ body, user, request }) => {
      const slug = await generateDbSlug(schema.organization, body.name);

      const createdOrg = await auth.api.createOrganization({
        body: {
          name: body.name,
          slug,
          userId: user.id,
          keepCurrentActiveOrganization: false,
        },
        headers: request.headers,
      });

      if (!createdOrg) {
        return status(500, "Failed to create organization");
      }

      const data = await auth.api.getFullOrganization({
        query: {
          organizationId: createdOrg.id,
        },
        headers: request.headers,
      });

      if (!data) {
        return status(500, "Failed to get organization");
      }

      return data;
    },
    {
      auth: true,
      body: createOrganizationSchema,
    }
  )
  .group(
    "/bySlug/:slug",
    {
      auth: true,
      activeOrganization: true,
      params: z.object({
        slug: z.string(),
      }),
    },
    (app) => app.use(integrationsRoutes).use(apiKeysRoutes)
  );
