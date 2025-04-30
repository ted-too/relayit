import { Hono } from "hono";
import type { Context } from "@repo/api";
import { apiKeyMiddleware } from "@repo/api/lib/middleware";

export const sendRouter = new Hono<Context>()
  .use(apiKeyMiddleware)
  .post("/", (c) => {
    return c.json({ message: "Hello, world!" });
  });
