import { cors } from "@elysiajs/cors";
import { env } from "@repo/api/server/env";
import { betterAuth } from "@repo/api/server/lib/auth/handler";
import { organizationRoutes } from "@repo/api/server/routes/organization";
import { sendRoutes } from "@repo/api/server/routes/send";
import { logger } from "@repo/api/utils";
import { Elysia } from "elysia";

const app = new Elysia()
  .use(
    cors({
      origin: env.APP_URL,
      methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  )
  .onRequest(({ request }) => {
    logger.info(`${request.method} ${request.url}`);
  })
  .mount(betterAuth)
  .use(organizationRoutes)
  .use(sendRoutes);

export function startServer() {
  app.listen(env.PORT, ({ hostname, port }) => {
    logger.info(`🦊 Elysia is running at ${hostname}:${port}`);
  });
}

export type App = typeof app;
