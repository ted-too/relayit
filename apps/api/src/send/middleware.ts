import { db } from "@repo/shared/db";
import type { Organization } from "@repo/shared/db/types";
import type { Context } from "hono";
import { createFactory } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import z from "zod";
import { auth } from "@/lib/auth";
import { errorResponse } from "@/send/schemas";

export interface ApiKeyContext {
  organization: Organization;
  apiKeyId: string;
}

const factory = createFactory<{ Variables: ApiKeyContext }>();

export const apiKeyMiddleware = factory.createMiddleware(async (c, next) => {
  const projectSlug = c.req.param("project");

  if (!projectSlug) {
    throw new HTTPException(404, { message: "Project slug is required" });
  }

  const apiKey = c.req.header("X-API-Key");
  if (!apiKey) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const { valid, error, key } = await auth.api.verifyApiKey({
    body: {
      key: apiKey,
    },
  });

  if (!(valid && key)) {
    throw new HTTPException(401, { message: error?.message ?? "Unauthorized" });
  }

  const organizations = await db.query.apikeyOrganization.findMany({
    where: (table, { eq }) => eq(table.apikeyId, key.id),
    with: {
      organization: true,
    },
  });

  if (organizations.length === 0) {
    throw new HTTPException(401, { message: "Unauthorized" });
  }

  const organization = organizations.find(
    (organization) => organization.organization.slug === projectSlug
  );

  if (!organization) {
    throw new HTTPException(404, { message: "Project not found" });
  }

  c.set("organization", organization.organization);
  c.set("apiKeyId", key.id);

  await next();
});

export const errorHandler = (err: Error | HTTPException, c: Context) => {
  if (err instanceof HTTPException) {
    return errorResponse(c, {
      status: err.status,
      message: err.message,
      details: Array.isArray(err.cause) ? err.cause : [],
    });
  }

  if (err instanceof z.core.$ZodError) {
    return errorResponse(c, {
      status: 400,
      message: "Validation error",
      details: err.issues.map((error) => error.message),
    });
  }

  return errorResponse(c, {
    status: 500,
    message: "Something went wrong",
    details: [],
  });
};
