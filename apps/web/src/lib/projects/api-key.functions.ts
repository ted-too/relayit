import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Effect } from "effect";
import { sessionMiddleware } from "@/lib/auth.functions";
import { auth } from "@/lib/auth.server";
import { runApp } from "@/lib/layers.server";
import {
  createApiKeyInputSchema,
  listApiKeysInputSchema,
  updateApiKeyInputSchema,
} from "@/lib/projects/api-key-schemas";
import { hydrateApiKey } from "@/lib/projects/api-keys.server";
import { requireOrganizationBySlug } from "@/lib/projects/org.server";

const assertApiKeyPermission = async (input: {
  readonly organizationId: string;
  readonly permission: "create" | "read" | "update";
}) => {
  const headers = getRequestHeaders();
  const allowed = await auth.api.hasPermission({
    body: {
      organizationId: input.organizationId,
      permissions: { apiKey: [input.permission] },
    },
    headers,
  });

  if (!allowed) {
    throw new Error("You do not have permission to manage API keys");
  }
};

export const listApiKeysFn = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .validator(listApiKeysInputSchema)
  .handler(async ({ data }) => {
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertApiKeyPermission({
      organizationId: org.id,
      permission: "read",
    });

    const headers = getRequestHeaders();
    const listed = await auth.api.listApiKeys({
      headers,
      query: { organizationId: org.id },
    });

    return await runApp(
      Effect.forEach(listed.apiKeys, hydrateApiKey, {
        concurrency: "unbounded",
      })
    );
  });

export const createApiKeyFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(createApiKeyInputSchema)
  .handler(async ({ data, context }) => {
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertApiKeyPermission({
      organizationId: org.id,
      permission: "create",
    });

    const headers = getRequestHeaders();
    const expiresInMs = data.expiresAt
      ? new Date(data.expiresAt).getTime() - Date.now()
      : undefined;

    const apiKey = await auth.api.createApiKey({
      body: {
        configId: "org-keys",
        expiresIn: expiresInMs ? Math.floor(expiresInMs / 1000) : undefined,
        name: data.name,
        organizationId: org.id,
      },
      headers,
    });

    const { key, ...rest } = apiKey;
    const metadata = {
      createdBy: context.session.user.id,
      end: key.slice(-6),
    };

    await auth.api.updateApiKey({
      body: {
        configId: "org-keys",
        keyId: rest.id,
        metadata,
      },
      headers,
    });

    const hydrated = await runApp(hydrateApiKey({ ...rest, metadata }));

    return { data: hydrated, key };
  });

export const updateApiKeyFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(updateApiKeyInputSchema)
  .handler(async ({ data }) => {
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertApiKeyPermission({
      organizationId: org.id,
      permission: "update",
    });

    const headers = getRequestHeaders();
    const expiresInMs = data.expiresAt
      ? new Date(data.expiresAt).getTime() - Date.now()
      : undefined;

    const apiKey = await auth.api.updateApiKey({
      body: {
        configId: "org-keys",
        expiresIn: expiresInMs ? Math.floor(expiresInMs / 1000) : undefined,
        keyId: data.id,
        name: data.name,
      },
      headers,
    });

    const hydrated = await runApp(hydrateApiKey(apiKey));
    return { data: hydrated };
  });
