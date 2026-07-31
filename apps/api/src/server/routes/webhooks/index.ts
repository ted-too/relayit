import { Elysia } from "elysia";
import { providerWebhookRoutes } from "./providers";

export const webhookRoutes = new Elysia().use(providerWebhookRoutes);
