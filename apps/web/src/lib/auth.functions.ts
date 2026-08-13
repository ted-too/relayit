import { ROLES } from "@repo/persistence/auth/constants";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { auth } from "@/lib/auth.server";

const readSession = async () => {
  const headers = getRequestHeaders();
  return await auth.api.getSession({ headers });
};

export const getSession = createServerFn({ method: "GET" }).handler(
  async () => await readSession()
);

/** Requires a signed-in session; attaches it to server-fn context. */
export const sessionMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const session = await readSession();
    if (!session) {
      throw new Error("Unauthorized");
    }
    return next({ context: { session } });
  }
);

/** Requires an Admin role (composes sessionMiddleware). */
export const adminMiddleware = createMiddleware({ type: "function" })
  .middleware([sessionMiddleware])
  .server(({ next, context }) => {
    if (context.session.user.role !== ROLES.admin) {
      throw new Error("Unauthorized");
    }
    return next();
  });
