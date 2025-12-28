import { cors } from "@elysiajs/cors";
import { betterAuth } from "@repo/api/lib/auth-handler";
import { organizationRoutes } from "@repo/api/routes/organization";
import { sendRoutes } from "@repo/api/routes/send";
import { db } from "@repo/shared/db";
import { logger } from "@repo/shared/utils";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Elysia } from "elysia";

const app = new Elysia()
  .use(
    cors({
      origin: process.env.WEB_URL,
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

async function startServer() {
  await migrate(db, { migrationsFolder: "./drizzle" });

  app.listen(3005, ({ hostname, port }) => {
    logger.info(`🦊 Elysia is running at ${hostname}:${port}`);
  });
}

await startServer();

export type App = typeof app;
