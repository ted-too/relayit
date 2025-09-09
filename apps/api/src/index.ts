import { trpcServer } from "@hono/trpc-server";
import { auth } from "@repo/api/lib/auth";
import type { Context } from "@repo/api/trpc";
import { appRouter } from "@repo/api/trpc/router";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";

const app = new Hono<{ Variables: Context }>();

app.use(logger());

app.use(
  "*",
  cors({
    origin: [process.env.APP_URL],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["POST", "GET", "OPTIONS"],
    exposeHeaders: ["Content-Length"],
    maxAge: 600,
    credentials: true,
  })
);

app.use("*", async (c, next) => {
  const session = await auth.api.getSession({ headers: c.req.raw.headers });
  if (!session) {
    c.set("user", null);
    c.set("session", null);
    return next();
  }
  c.set("user", session.user);
  c.set("session", session.session);
  return next();
});

app.on(["POST", "GET"], "/auth/*", (c) => {
  return auth.handler(c.req.raw);
});

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (_, c) => {
      const session = c.get("session");
      const user = c.get("user");

      return {
        user,
        session,
      };
    },
  })
);

export default {
  port: 3005,
  fetch: app.fetch,
};
