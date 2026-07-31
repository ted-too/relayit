import { Elysia } from "elysia";
import { legacySendRoutes } from "./send";

export const compatRoutes = new Elysia().use(legacySendRoutes);
