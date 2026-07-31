import { Elysia } from "elysia";
import { domainsRoutes } from "./domains";

export const emailChannelRoutes = new Elysia({
  prefix: "/channels/email",
}).use(domainsRoutes);
