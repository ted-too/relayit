import { Elysia } from "elysia";
import { apiKeysRoutes } from "./api-keys";
import { appEnvironmentsRoutes } from "./app-environments";
import { billingUserRoutes } from "./billing-user";
import { campaignsRoutes } from "./campaigns";
import { channelsRoutes } from "./channels";
import { contactsRoutes } from "./contacts";
import { projectRoutes } from "./project";
import { providersRoutes } from "./providers";
import { segmentsRoutes } from "./segments";
import { suppressionsRoutes } from "./suppressions";
import { templatingRoutes } from "./templating";
import { topicsRoutes } from "./topics";
import { unsubscribesRoutes } from "./unsubscribes";
import { usageRoutes } from "./usage";
import { webhookEndpointsRoutes } from "./webhook-endpoints";

/**
 * Project-scoped management routes.
 * Resources nest under /projects/:orgSlug/… where orgSlug is the Better Auth
 * organization slug (product: Project).
 */
export const projectsRoutes = new Elysia()
  .use(projectRoutes)
  .group("/projects/:orgSlug", (app) =>
    app
      .use(apiKeysRoutes)
      .use(appEnvironmentsRoutes)
      .use(billingUserRoutes)
      .use(campaignsRoutes)
      .use(channelsRoutes)
      .use(contactsRoutes)
      .use(providersRoutes)
      .use(templatingRoutes)
      .use(topicsRoutes)
      .use(segmentsRoutes)
      .use(suppressionsRoutes)
      .use(unsubscribesRoutes)
      .use(usageRoutes)
      .use(webhookEndpointsRoutes)
  );
