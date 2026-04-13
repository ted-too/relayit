import { db } from "@repo/api/db";
import { auth } from "@repo/api/server/lib/auth";
import { Elysia, status } from "elysia";
import z from "zod";

export const betterAuth = new Elysia({ name: "better-auth" })
  .mount(auth.handler)
  .macro({
    auth: {
      async resolve({ status, request: { headers } }) {
        const session = await auth.api.getSession({
          headers,
        });

        if (!session) {
          return status(401);
        }

        return {
          user: session.user,
          session: session.session,
        };
      },
    },
  });

export const activeOrganization = new Elysia({ name: "active-organization" })
  .use(betterAuth)
  .guard({
    auth: true,
    params: z.object({
      slug: z.string(),
    }),
  })
  .macro({
    activeOrganization: {
      async resolve({ params, request }) {
        let activeOrganization = await auth.api.getFullOrganization({
          headers: request.headers,
          query: { organizationSlug: params.slug },
        });

        if (!activeOrganization || activeOrganization.slug !== params.slug) {
          const organizationToSet = await db.query.organization.findFirst({
            where: (table, { eq }) => eq(table.slug, params.slug),
          });

          if (!organizationToSet) {
            return status(404, "Organization not found");
          }

          await auth.api.setActiveOrganization({
            body: {
              organizationId: organizationToSet.id,
            },
            headers: request.headers,
          });

          activeOrganization = await auth.api.getFullOrganization({
            headers: request.headers,
            query: { organizationId: organizationToSet.id },
          });
        }

        return { organization: activeOrganization! };
      },
    },
  });

export const betterAuthApiKey = new Elysia({ name: "better-auth-api-key" })
  .use(betterAuth)
  .guard({
    headers: z.object({
      "X-API-KEY": z.string(),
    }),
    params: z.object({
      project: z.string(),
    }),
  })
  .macro({
    auth: {
      async resolve({ params, headers }) {
        const { valid, key } = await auth.api.verifyApiKey({
          body: {
            key: headers["X-API-KEY"],
          },
        });

        if (!(valid && key)) {
          return status(401);
        }

        const organizationsWithApiKey =
          await db.query.apikeyOrganization.findMany({
            where: (table, { eq }) => eq(table.apikeyId, key.id),
            with: {
              organization: true,
            },
          });

        if (organizationsWithApiKey.length === 0) {
          return status(401);
        }

        const organizationForApiKey = organizationsWithApiKey.find(
          (organization) => organization.organization.slug === params.project
        );

        if (!organizationForApiKey) {
          return status(404, "Project not found");
        }

        return {
          organization: organizationForApiKey.organization,
          apiKeyId: key.id,
        };
      },
    },
  });
