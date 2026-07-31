import { Elysia } from "elysia";
import { adminRoutes } from "./admin";
import { compatRoutes } from "./compat";
import { messagesRoutes } from "./messages";
import { projectsRoutes } from "./projects";
import { webhookRoutes } from "./webhooks";

export const routes = new Elysia()
  .use(adminRoutes)
  .use(projectsRoutes)
  .use(messagesRoutes)
  .use(webhookRoutes)
  .use(compatRoutes);
