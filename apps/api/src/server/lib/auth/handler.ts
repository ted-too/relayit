import { db } from "@repo/api/db";
import { auth } from "@repo/api/server/lib/auth";
import { logger } from "@repo/api/utils";
import { apiKeyHeadersSchema } from "@repo/api/validators";
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

export const betterAuthIsAdmin = new Elysia({ name: "better-auth-is-admin" })
  .use(betterAuth)
  .guard({
    auth: true,
  })
  .macro({
    isAdmin: {
      resolve({ user }) {
        if (user?.role !== "admin") {
          return status(403, "Forbidden");
        }
      },
    },
  });

export const betterAuthOrganization = new Elysia({
  name: "better-auth-organization",
})
  .use(betterAuth)
  .guard({
    auth: true,
    params: z.object({
      orgSlug: z.string(),
    }),
  })
  .macro({
    organization: {
      async resolve({ params, request }) {
        const organization = await auth.api.getFullOrganization({
          headers: request.headers,
          query: { organizationSlug: params.orgSlug },
        });

        if (!organization) {
          return status(404, "Organization not found");
        }

        const organizationOwner = organization.members.find(
          (member) => member.role === "owner"
        );

        if (!organizationOwner) {
          return status(500, "Organization owner not found");
        }

        return { organization, organizationOwner };
      },
    },
  });

export const betterAuthApiKey = new Elysia({ name: "better-auth-api-key" })
  .guard({
    headers: apiKeyHeadersSchema,
  })
  .macro({
    auth: {
      async resolve({ headers, request }) {
        logger.info({ headers }, "Verifying API key");
        const { valid, key } = await auth.api.verifyApiKey({
          headers: request.headers,
          body: {
            key: headers["x-api-key"],
            configId: "org-keys",
          },
        });

        if (!(valid && key)) {
          return status(403, {
            code: "invalid_api_key",
            message: "Invalid API key",
          });
        }

        const organization = await db.query.organization.findFirst({
          where: (table, { eq }) => eq(table.id, key.referenceId),
        });

        if (!organization) {
          return status(403, {
            code: "invalid_api_key",
            message: "Invalid API key",
          });
        }

        const organizationOwner = await db.query.member.findFirst({
          where: (table, { eq, and }) =>
            and(
              eq(table.organizationId, organization.id),
              eq(table.role, "owner")
            ),
        });

        if (!organizationOwner) {
          logger.error(
            { apiKeyId: key.id, organizationId: organization.id },
            "API Key is not associated with an organization owner"
          );
          return status(500, {
            code: "internal_server_error",
            message: "Internal server error",
          });
        }

        return {
          organization,
          organizationOwnerUserId: organizationOwner.userId,
          apiKeyId: key.id,
        };
      },
    },
  });
