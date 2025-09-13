import { Hono } from "hono";
import {
  type ApiKeyContext,
  apiKeyMiddleware,
  errorHandler,
} from "@/send/middleware";
import { sendRawRouter } from "@/send/using/raw";
import { sendTemplateRouter } from "@/send/using/template";

export const sendRouter = new Hono<{ Variables: ApiKeyContext }>()
  .basePath("/send/:project")
  .use(apiKeyMiddleware)
  .route("/raw", sendRawRouter)
  .route("/template", sendTemplateRouter)
  .onError(errorHandler);
