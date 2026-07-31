import { cors } from "@elysiajs/cors";
import { bootstrapPlatformEmailReceiving } from "@repo/api/channels/email/providers/platform-bootstrap";
import { env } from "@repo/api/server/env";
import { betterAuth } from "@repo/api/server/lib/auth/handler";
import { apiRedis } from "@repo/api/server/lib/redis";
import { routes } from "@repo/api/server/routes";
import { logger } from "@repo/api/utils";
import { Elysia } from "elysia";

export const app = new Elysia({
  serve: {
    hostname: env.HOST,
  },
})
  .use(
    cors({
      origin: env.APP_URL,
      methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  )
  .onRequest(({ request }) => {
    if (env.REQUEST_LOGGING_ENABLED === "false") {
      return;
    }
    logger.info(
      { method: request.method, url: request.url },
      "Request received"
    );
  })
  .get("/health", () => ({ status: "ok" }))
  .mount(betterAuth)
  .use(routes);

export function startServer() {
  bootstrapPlatformEmailReceiving().catch((error) => {
    logger.error({ error }, "Platform email receiving bootstrap failed");
  });

  app.listen(env.PORT, ({ hostname, port }) => {
    logger.info({ host: hostname, port }, "🦊 Elysia is running");
  });
}

/**
 * Stop accepting new connections and drain in-flight requests, then release the
 * server-side Redis connection. Safe to call even if the server never started.
 */
export async function stopServer() {
  try {
    await app.stop();
  } catch (error) {
    logger.error({ error }, "Error stopping HTTP server");
  }

  apiRedis.close();
}

export type App = typeof app;
