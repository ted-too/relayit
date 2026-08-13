import { Elysia, status } from "elysia";
import { z } from "zod";
import type { ApiAuth } from "./auth";

export const apiKeyHeadersSchema = z.object({
  "x-api-key": z.string().describe("The API key to use for the request."),
});

export type ApiKeyHeaders = z.infer<typeof apiKeyHeadersSchema>;

export const createApiKeyMiddleware = ({ auth, db }: ApiAuth) =>
  new Elysia({ name: "api-key" })
    .guard({ headers: apiKeyHeadersSchema })
    .macro({
      apiKey: {
        async resolve({ headers, request }) {
          const result = await auth.api.verifyApiKey({
            body: {
              configId: "org-keys",
              key: headers["x-api-key"],
            },
            headers: request.headers,
          });

          if (!(result.valid && result.key)) {
            return status(403, {
              code: "invalid_api_key",
              message: "Invalid API key",
            });
          }

          const organization = await db.query.organization.findFirst({
            columns: { id: true },
            where: { id: result.key.referenceId },
          });
          if (!organization) {
            return status(403, {
              code: "invalid_api_key",
              message: "Invalid API key",
            });
          }

          const owner = await db.query.member.findFirst({
            columns: { userId: true },
            where: {
              organizationId: organization.id,
              role: "owner",
            },
          });
          if (!owner) {
            return status(500, {
              code: "internal_server_error",
              message: "Project owner not found",
            });
          }

          return {
            apiKeyId: result.key.id,
            organizationId: organization.id,
            organizationOwnerUserId: owner.userId,
          };
        },
      },
    });
