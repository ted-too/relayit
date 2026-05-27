import { db } from "@repo/api/db";
import { auth } from "@repo/api/server/lib/auth";
import {
  activeOrganization,
  betterAuth,
} from "@repo/api/server/lib/auth/handler";
import { createApiKeySchema } from "@repo/shared/forms";
import { Elysia, status } from "elysia";
import * as z from "zod";

async function hydrateApiKey<T extends { id: string; metadata: any }>({
  metadata,
  ...rest
}: T) {
  if (!(metadata && "createdBy" in metadata)) {
    return { ...rest, end: null, createdBy: null };
  }

  const createdBy = await db.query.user.findFirst({
    where: (table, { eq }) => eq(table.id, metadata.createdBy),
    columns: {
      name: true,
      email: true,
      image: true,
    },
  });

  return {
    ...rest,
    end: (metadata?.end as string | null) ?? null,
    createdBy: createdBy ?? null,
  };
}

export const apiKeysRoutes = new Elysia({ prefix: "/apiKeys" })
  .use(betterAuth)
  .use(activeOrganization)
  .guard({
    activeOrganization: true,
    auth: true,
  })
  .post(
    "/",
    async ({ body, organization, request, user }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: {
            apiKey: ["create"],
          },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to create API keys");
      }

      const expiresInMs = body.expiresAt
        ? new Date(body.expiresAt).getTime() - Date.now()
        : undefined;

      const apiKey = await auth.api.createApiKey({
        headers: request.headers,
        body: {
          name: body.name,
          configId: "org-keys",
          organizationId: organization.id,
          expiresIn: expiresInMs ? Math.floor(expiresInMs / 1000) : undefined,
        },
      });

      const { key, ...rest } = apiKey;

      const metadata = {
        createdBy: user.id,
        end: key.slice(-6),
      };

      await auth.api.updateApiKey({
        headers: request.headers,
        body: {
          keyId: rest.id,
          configId: "org-keys",
          metadata,
        },
      });

      return { key, data: hydrateApiKey({ ...rest, metadata }) };
    },
    {
      body: createApiKeySchema,
    }
  )
  .put(
    "/:id",
    async ({ params, body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: {
            apiKey: ["update"],
          },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to update API keys");
      }

      const expiresInMs = body.expiresAt
        ? new Date(body.expiresAt).getTime() - Date.now()
        : undefined;

      const apiKey = await auth.api.updateApiKey({
        headers: request.headers,
        body: {
          keyId: params.id,
          name: body.name,
          expiresIn: expiresInMs ? Math.floor(expiresInMs / 1000) : undefined,
        },
      });

      return { data: hydrateApiKey(apiKey) };
    },
    {
      body: createApiKeySchema,
      params: z.object({
        id: z.string(),
      }),
    }
  )
  .get("/", async ({ organization, request }) => {
    const hasPermission = await auth.api.hasPermission({
      headers: request.headers,
      body: {
        organizationId: organization.id,
        permissions: {
          apiKey: ["read"],
        },
      },
    });

    if (!hasPermission) {
      return status(403, "You do not have permission to read API keys");
    }

    const apiKeys = await Promise.all(
      (
        await auth.api.listApiKeys({
          headers: request.headers,
          query: {
            organizationId: organization.id,
          },
        })
      ).apiKeys.map(hydrateApiKey)
    );

    return apiKeys;
  });
