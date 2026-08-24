import { acceptTransactionalEmail } from "@repo/channels/email/accept";
import { Cause, Effect } from "effect";
import { Elysia, status } from "elysia";
import type { ApiAuth } from "../../../lib/auth";
import type { RunApiEffect } from "../../../lib/effect";
import { logEffectFailure } from "../../../lib/log-failure";
import {
  mapAcceptResultToLegacyResponse,
  mapLegacyRawToAccept,
  mapLegacyTemplateToAccept,
  resolveLegacyDefaultFromAddress,
} from "./map";
import {
  legacyApiKeyHeadersSchema,
  legacySendProjectParamsSchema,
  legacySendRawBodySchema,
  legacySendTemplateBodySchema,
} from "./validators";

const authenticateLegacySend = async ({
  db,
  headers,
  projectSlug,
  requestHeaders,
  verifyApiKey,
}: {
  readonly db: ApiAuth["db"];
  readonly headers: {
    readonly "X-API-Key"?: string;
    readonly "x-api-key"?: string;
  };
  readonly projectSlug: string;
  readonly requestHeaders: Headers;
  readonly verifyApiKey: ApiAuth["auth"]["api"]["verifyApiKey"];
}) => {
  const apiKey = headers["x-api-key"] ?? headers["X-API-Key"];
  if (!apiKey) {
    return {
      body: { details: [] as string[], message: "Unauthorized" },
      ok: false as const,
      status: 401 as const,
    };
  }

  const result = await verifyApiKey({
    body: {
      configId: "org-keys",
      key: apiKey,
    },
    headers: requestHeaders,
  });

  if (!(result.valid && result.key)) {
    return {
      body: {
        details: [] as string[],
        message: result.error?.message ?? "Unauthorized",
      },
      ok: false as const,
      status: 401 as const,
    };
  }

  const organization = await db.query.organization.findFirst({
    columns: { id: true, slug: true },
    where: { id: result.key.referenceId },
  });

  if (!organization) {
    return {
      body: { details: [] as string[], message: "Unauthorized" },
      ok: false as const,
      status: 401 as const,
    };
  }

  if (organization.slug !== projectSlug) {
    return {
      body: { details: [] as string[], message: "Project not found" },
      ok: false as const,
      status: 404 as const,
    };
  }

  return { ok: true as const, organization };
};

/**
 * Temporary compat surface for apps still on prod Relayit send paths.
 * Prefer `POST /messages/email` for new integrations.
 *
 * - `POST /send/:project/raw/email`
 * - `POST /send/:project/template/email`
 */
export const createLegacySendRoutes = (
  auth: ApiAuth,
  runEffect: RunApiEffect,
  accept = acceptTransactionalEmail
) =>
  new Elysia({ prefix: "/send/:project", tags: ["Legacy Send"] })
    .guard({
      headers: legacyApiKeyHeadersSchema,
      params: legacySendProjectParamsSchema,
    })
    .post(
      "/raw/email",
      async ({ body, headers, params, request }) => {
        const authResult = await authenticateLegacySend({
          db: auth.db,
          headers,
          projectSlug: params.project,
          requestHeaders: request.headers,
          verifyApiKey: auth.auth.api.verifyApiKey,
        });
        if (!authResult.ok) {
          return status(authResult.status, authResult.body);
        }

        const from =
          body.from ??
          (await resolveLegacyDefaultFromAddress({
            db: auth.db,
            organizationId: authResult.organization.id,
          }));
        const mapped = mapLegacyRawToAccept({
          body,
          from: from ?? undefined,
          organizationId: authResult.organization.id,
        });
        if (!mapped.ok) {
          return status(mapped.status, {
            details: mapped.details,
            message: mapped.message,
          });
        }

        return runEffect(
          accept(mapped.input).pipe(
            Effect.annotateLogs({ organizationId: authResult.organization.id }),
            Effect.map((accepted) => {
              const response = mapAcceptResultToLegacyResponse(accepted);
              return status(response.status, response.body);
            }),
            Effect.catch((error) =>
              Effect.gen(function* () {
                switch (error._tag) {
                  case "EmailAcceptRejected":
                  case "UsageLimitExceeded": {
                    const response = mapAcceptResultToLegacyResponse(error);
                    return status(response.status, response.body);
                  }
                  default:
                    yield* logEffectFailure("Legacy raw send failed")(
                      Cause.fail(error)
                    );
                    return status(500, {
                      details: [] as string[],
                      message: "Something went wrong",
                    });
                }
              })
            )
          ),
          { signal: request.signal }
        );
      },
      {
        body: legacySendRawBodySchema,
        detail: {
          description:
            "Compatibility send with inline html/text. Prefer POST /messages/email.",
          summary: "Send raw email",
        },
      }
    )
    .post(
      "/template/email",
      async ({ body, headers, params, request }) => {
        const authResult = await authenticateLegacySend({
          db: auth.db,
          headers,
          projectSlug: params.project,
          requestHeaders: request.headers,
          verifyApiKey: auth.auth.api.verifyApiKey,
        });
        if (!authResult.ok) {
          return status(authResult.status, authResult.body);
        }

        const from =
          body.from ??
          (await resolveLegacyDefaultFromAddress({
            db: auth.db,
            organizationId: authResult.organization.id,
          }));
        const mapped = mapLegacyTemplateToAccept({
          body,
          from: from ?? undefined,
          organizationId: authResult.organization.id,
        });
        if (!mapped.ok) {
          return status(mapped.status, {
            details: mapped.details,
            message: mapped.message,
          });
        }

        return runEffect(
          accept(mapped.input).pipe(
            Effect.annotateLogs({ organizationId: authResult.organization.id }),
            Effect.map((accepted) => {
              const response = mapAcceptResultToLegacyResponse(accepted);
              return status(response.status, response.body);
            }),
            Effect.catch((error) =>
              Effect.gen(function* () {
                switch (error._tag) {
                  case "EmailAcceptRejected":
                  case "UsageLimitExceeded": {
                    const response = mapAcceptResultToLegacyResponse(error);
                    return status(response.status, response.body);
                  }
                  default:
                    yield* logEffectFailure("Legacy template send failed")(
                      Cause.fail(error)
                    );
                    return status(500, {
                      details: [] as string[],
                      message: "Something went wrong",
                    });
                }
              })
            )
          ),
          { signal: request.signal }
        );
      },
      {
        body: legacySendTemplateBodySchema,
        detail: {
          description:
            "Compatibility send using a Template. Prefer POST /messages/email.",
          summary: "Send template email",
        },
      }
    );
