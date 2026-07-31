import { schema } from "@repo/api/db";
import { auth } from "@repo/api/server/lib/auth";
import { betterAuth } from "@repo/api/server/lib/auth/handler";
import { generateDbSlug } from "@repo/api/slug";
import { createProjectBodySchema } from "@repo/api/validators/routes/projects/project";
import { Elysia, status } from "elysia";

/**
 * Collection routes for Projects (Better Auth organizations).
 * Create lives here so slug generation and post-create provisioning stay on
 * the server — not on Better Auth's client createOrganization.
 */
export const projectRoutes = new Elysia({ prefix: "/projects" })
  .use(betterAuth)
  .post(
    "/",
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
        return status(500, "Failed to create Project");
      }

      const data = await auth.api.getFullOrganization({
        query: {
          organizationId: createdOrg.id,
        },
        headers: request.headers,
      });

      if (!data) {
        return status(500, "Failed to load Project after create");
      }

      return data;
    },
    {
      auth: true,
      body: createProjectBodySchema,
    }
  );
