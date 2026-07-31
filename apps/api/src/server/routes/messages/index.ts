import { Elysia } from "elysia";
import { messageRoutes } from "./message";

export const messagesRoutes = new Elysia().use(messageRoutes);
