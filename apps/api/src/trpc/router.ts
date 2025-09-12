import { router } from ".";
import { authRouter } from "./auth";
import { integrationsRouter } from "./integrations";
import { projectRouter } from "./project";

export const appRouter = router({
  auth: authRouter,
  project: projectRouter,
  integrations: integrationsRouter,
});

export type AppRouter = typeof appRouter;
