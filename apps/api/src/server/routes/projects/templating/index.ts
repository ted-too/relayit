import { Elysia } from "elysia";
import { templatingTemplatesRoutes } from "./templates";
import { templatingWorkspaceRoutes } from "./workspace";

/**
 * Templating surface: Template catalog + kinded workspaces.
 * @see docs/adr/0005-template-workspace-sealed-artifacts.md
 */
export const templatingRoutes = new Elysia()
  .use(templatingTemplatesRoutes)
  .use(templatingWorkspaceRoutes);
