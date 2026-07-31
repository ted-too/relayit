import { db } from "@repo/api/db";
import { acceptTransactionalEmail } from "@repo/api/messages/accept";
import { auth } from "@repo/api/server/lib/auth";
import { apiRedis } from "@repo/api/server/lib/redis";
import { logger } from "@repo/api/utils";
import {
  legacyApiKeyHeadersSchema,
  legacySendProjectParamsSchema,
  legacySendRawBodySchema,
  legacySendTemplateBodySchema,
} from "@repo/api/validators/routes/compat/send";
import { Elysia, status } from "elysia";
import {
  mapAcceptResultToLegacyResponse,
  mapLegacyRawToAcceptBody,
  mapLegacyTemplateToAcceptBody,
} from "./map";

async function authenticateLegacySend({
  projectSlug,
  apiKey,
  requestHeaders,
}: {
  projectSlug: string;
  apiKey: string;
  requestHeaders: Headers;
}) {
  const { valid, key, error } = await auth.api.verifyApiKey({
    headers: requestHeaders,
    body: {
      key: apiKey,
      configId: "org-keys",
    },
  });

  if (!(valid && key)) {
    return {
      ok: false as const,
      status: 401 as const,
      body: {
        message: error?.message ?? "Unauthorized",
        details: [] as string[],
      },
    };
  }

  const organization = await db.query.organization.findFirst({
    where: (table, { eq: equals }) => equals(table.id, key.referenceId),
  });

  if (!organization) {
    return {
      ok: false as const,
      status: 401 as const,
      body: { message: "Unauthorized", details: [] as string[] },
    };
  }

  if (organization.slug !== projectSlug) {
    return {
      ok: false as const,
      status: 404 as const,
      body: { message: "Project not found", details: [] as string[] },
    };
  }

  return { ok: true as const, organization };
}

/**
 * Temporary compat surface for apps still on prod Relayit send paths.
 * Prefer `POST /messages/email` for new integrations.
 *
 * - `POST /send/:project/raw/email`
 * - `POST /send/:project/template/email`
 */
export const legacySendRoutes = new Elysia({ prefix: "/send/:project" })
  .guard({
    params: legacySendProjectParamsSchema,
    headers: legacyApiKeyHeadersSchema,
  })
  .post(
    "/raw/email",
    async ({ body, params, headers, request }) => {
      const authResult = await authenticateLegacySend({
        projectSlug: params.project,
        apiKey: headers["x-api-key"],
        requestHeaders: request.headers,
      });
      if (!authResult.ok) {
        return status(authResult.status, authResult.body);
      }

      const mapped = await mapLegacyRawToAcceptBody({
        db,
        organizationId: authResult.organization.id,
        body,
      });
      if (!mapped.ok) {
        return status(mapped.status, {
          message: mapped.message,
          details: mapped.details,
        });
      }

      try {
        const result = await acceptTransactionalEmail({
          db,
          redis: apiRedis,
          organizationId: authResult.organization.id,
          app: mapped.app,
          environment: mapped.environment,
          body: mapped.body,
        });
        const response = mapAcceptResultToLegacyResponse(result);
        return status(response.status, response.body);
      } catch (error) {
        logger.error({ error, path: request.url }, "Legacy raw send failed");
        return status(500, {
          message: "Something went wrong",
          details: [],
        });
      }
    },
    { body: legacySendRawBodySchema }
  )
  .post(
    "/template/email",
    async ({ body, params, headers, request }) => {
      const authResult = await authenticateLegacySend({
        projectSlug: params.project,
        apiKey: headers["x-api-key"],
        requestHeaders: request.headers,
      });
      if (!authResult.ok) {
        return status(authResult.status, authResult.body);
      }

      const mapped = await mapLegacyTemplateToAcceptBody({
        db,
        organizationId: authResult.organization.id,
        body,
      });
      if (!mapped.ok) {
        return status(mapped.status, {
          message: mapped.message,
          details: mapped.details,
        });
      }

      try {
        const result = await acceptTransactionalEmail({
          db,
          redis: apiRedis,
          organizationId: authResult.organization.id,
          app: mapped.app,
          environment: mapped.environment,
          body: mapped.body,
        });
        const response = mapAcceptResultToLegacyResponse(result);
        return status(response.status, response.body);
      } catch (error) {
        logger.error(
          { error, path: request.url },
          "Legacy template send failed"
        );
        return status(500, {
          message: "Something went wrong",
          details: [],
        });
      }
    },
    { body: legacySendTemplateBodySchema }
  );
