import { router } from ".";
import { authRouter } from "./auth";
import { integrationsRouter } from "./integrations";
import { projectRouter } from "./project";
import { templateRouter } from "./template";

export const appRouter = router({
  auth: authRouter,
  project: projectRouter,
  integrations: integrationsRouter,
  templates: templateRouter,
});

export type AppRouter = typeof appRouter;
