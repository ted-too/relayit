import { initTRPC, TRPCError } from "@trpc/server";
import { auth } from "@repo/api/lib/auth";
import { db, schema } from "@repo/db";
import z from "zod";
import { and, eq } from "drizzle-orm";
import superjson from "superjson";
import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

export const createContext = async (opts: FetchCreateContextFnOptions) => {
	const session = await auth.api.getSession({ headers: opts.req.headers });

	return {
		session: session?.session,
		user: session?.user,
	};
};

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create({
	transformer: superjson,
});

export const publicProcedure = t.procedure;
export const router = t.router;
export const createCallerFactory = t.createCallerFactory;

export const authdProcedure = publicProcedure.use(async (opts) => {
	const { ctx } = opts;
	if (!ctx.user || !ctx.session) {
		throw new TRPCError({ code: "UNAUTHORIZED" });
	}

	return opts.next({
		ctx: {
			user: ctx.user,
			session: ctx.session,
		},
	});
});

export const authdProcedureWithOrg = authdProcedure.use(async (opts) => {
	const { ctx } = opts;
	if (!ctx.session.activeOrganizationId) {
		throw new TRPCError({
			code: "BAD_REQUEST",
			message: "No organization selected",
		});
	}

	const organization = await db.query.organization.findFirst({
		where: eq(schema.organization.id, ctx.session.activeOrganizationId),
	});

	if (!organization) {
		throw new TRPCError({
			code: "NOT_FOUND",
			message: "Organization not found",
		});
	}

	return opts.next({
		ctx: {
			user: ctx.user,
			session: ctx.session as typeof ctx.session & {
				activeOrganizationId: string;
			},
			organization,
		},
	});
});

export const verifyProject = authdProcedureWithOrg
	.input(
		z.object({
			projectId: z.string(),
		}),
	)
	.use(async (opts) => {
		const { ctx, input } = opts;

		const project = await db.query.project.findFirst({
			where: and(
				eq(schema.project.id, input.projectId),
				eq(schema.project.organizationId, ctx.session.activeOrganizationId),
			),
		});

		if (!project) {
			throw new TRPCError({
				code: "NOT_FOUND",
				message: "Project not found",
			});
		}

		return opts.next({
			ctx: {
				project,
			},
		});
	});
