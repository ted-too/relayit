import { betterAuthApiKey } from "@repo/api/server/lib/auth/handler";
import { rawRoutes } from "@repo/api/server/routes/send/using/raw";
import { templateRoutes } from "@repo/api/server/routes/send/using/template";
import { Elysia } from "elysia";

export const sendRoutes = new Elysia({ prefix: "/send/:project" })
  .use(betterAuthApiKey)
  .use(rawRoutes)
  .use(templateRoutes);
