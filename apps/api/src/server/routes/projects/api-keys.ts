import { db } from "@repo/api/db";
import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import {
  apiKeyIdParamsSchema,
  createApiKeyBodySchema,
} from "@repo/api/validators/routes/projects/api-keys";
import { Elysia, status } from "elysia";

interface ApiKeyMetadata {
  createdBy?: string;
  end?: string | null;
}

async function hydrateApiKey<T extends { id: string; metadata?: unknown }>({
  metadata,
  ...rest
}: T) {
  const meta =
    metadata && typeof metadata === "object"
      ? (metadata as ApiKeyMetadata)
      : null;

  const createdById = meta?.createdBy;
  if (!createdById) {
    return { ...rest, end: null, createdBy: null };
  }

  const createdBy = await db.query.user.findFirst({
    where: (table, { eq }) => eq(table.id, createdById),
    columns: {
      name: true,
      email: true,
      image: true,
    },
  });

  return {
    ...rest,
    end: meta.end ?? null,
    createdBy: createdBy ?? null,
  };
}

export const apiKeysRoutes = new Elysia({ prefix: "/apiKeys" })
  .use(betterAuthOrganization)
  .guard({
    organization: true,
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

      const metadata: ApiKeyMetadata = {
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

      return {
        key,
        data: await hydrateApiKey({ ...rest, metadata }),
      };
    },
    {
      body: createApiKeyBodySchema,
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

      return { data: await hydrateApiKey(apiKey) };
    },
    {
      body: createApiKeyBodySchema,
      params: apiKeyIdParamsSchema,
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

    const listed = await auth.api.listApiKeys({
      headers: request.headers,
      query: {
        organizationId: organization.id,
      },
    });

    return Promise.all(listed.apiKeys.map(hydrateApiKey));
  });
