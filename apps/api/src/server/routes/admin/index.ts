import { Elysia } from "elysia";
import { adminProvidersRoutes } from "./providers";

export const adminRoutes = new Elysia({ prefix: "/admin" }).use(
  adminProvidersRoutes
);
