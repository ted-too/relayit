import { db } from "@repo/api/db";
import { acceptTransactionalEmail } from "@repo/api/messages/accept";
import { betterAuthApiKey } from "@repo/api/server/lib/auth/handler";
import { apiRedis } from "@repo/api/server/lib/redis";
import {
  sendEmailBodySchema,
  sendEmailHeadersSchema,
} from "@repo/api/validators/routes/messages";
import { Elysia, status } from "elysia";

/**
 * Resend-shaped transactional email Accept: `POST /messages/email`.
 * Domain work lives in `acceptTransactionalEmail`; this is the thin HTTP edge.
 */
export const emailRoutes = new Elysia({ prefix: "/email" })
  .use(betterAuthApiKey)
  .post(
    "/",
    async ({ body, organization, headers }) => {
      const result = await acceptTransactionalEmail({
        db,
        redis: apiRedis,
        organizationId: organization.id,
        app: headers.app,
        environment: headers.environment,
        idempotencyKey: headers["idempotency-key"],
        body,
      });

      if (!result.ok) {
        return status(result.status, {
          code: result.code,
          message: result.message,
          ...(result.retryAfterSeconds == null
            ? {}
            : { retry_after_seconds: result.retryAfterSeconds }),
        });
      }

      return status(201, {
        id: result.messageId,
        ...(result.stripped ? { stripped: result.stripped } : {}),
      });
    },
    {
      auth: true,
      body: sendEmailBodySchema,
      headers: sendEmailHeadersSchema,
    }
  );
