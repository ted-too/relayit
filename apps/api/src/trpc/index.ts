import type { auth } from "@repo/api/lib/auth";
import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";

export interface Context {
  user: typeof auth.$Infer.Session.user | null;
  session: typeof auth.$Infer.Session.session | null;
}

/**
 * Initialization of tRPC backend
 * Should be done only once per backend!
 */
const t = initTRPC.context<Context>().create({
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
