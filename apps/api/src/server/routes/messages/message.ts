import { Elysia } from "elysia";
import { emailRoutes } from "./email";

export const messageRoutes = new Elysia({ prefix: "/messages" }).use(
  emailRoutes
);
