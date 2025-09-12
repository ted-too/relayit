import { db } from "@repo/shared/db";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import type { auth } from "@/lib/auth";

export interface Context {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
}

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<Context & { req: Request }>().create({
  transformer: superjson,
});

/**
 * Export reusable router and procedure helpers
 * that can be used throughout the router
 */
export const router = t.router;
export const publicProcedure = t.procedure;

export const authdProcedure = publicProcedure.use((opts) => {
  const { ctx } = opts;
  if (!(ctx.user && ctx.session)) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  return opts.next({
    ctx: {
      user: ctx.user,
      session: ctx.session,
    },
  });
});

export const authdOrganizationProcedure = authdProcedure.use(async (opts) => {
  const {
    ctx: {
      session: { activeOrganizationId, ...session },
      user,
    },
  } = opts;
  if (!activeOrganizationId) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }

  const activeOrganization = await db.query.organization.findFirst({
    where: (table, { eq }) => eq(table.id, activeOrganizationId),
  });

  if (!activeOrganization) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }

  return opts.next({
    ctx: {
      session: {
        ...session,
        activeOrganization,
      },
      user,
    },
  });
});
