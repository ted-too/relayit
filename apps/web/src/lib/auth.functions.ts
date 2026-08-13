import { ROLES } from "@repo/persistence/auth/constants";
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
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

export const listOrganizations = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .handler(async () => {
    const headers = getRequestHeaders();
    return await auth.api.listOrganizations({ headers });
  });

export const getFullOrganization = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .validator(z.object({ organizationSlug: z.string().min(1) }))
  .handler(async ({ data }) => {
    const headers = getRequestHeaders();
    try {
      return await auth.api.getFullOrganization({
        headers,
        query: { organizationSlug: data.organizationSlug },
      });
    } catch (error) {
      const statusCode =
        error instanceof Error &&
        "statusCode" in error &&
        typeof error.statusCode === "number"
          ? error.statusCode
          : undefined;

      switch (statusCode) {
        case 400:
        case 401:
        case 403:
        case 404:
          return null;
        default:
          throw error;
      }
    }
  });
