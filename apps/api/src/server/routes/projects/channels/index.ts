import { Elysia } from "elysia";
import { emailChannelRoutes } from "./email";

/**
 * Channel-scoped Project resources (email Domains today; SMS later).
 * Mounted under /projects/:orgSlug — HTTP paths stay /channels/{channel}/…
 */
export const channelsRoutes = new Elysia().use(emailChannelRoutes);
