import { initialUserSetup } from "@repo/api/lib/auth";
import { authdProcedure, authdProcedureWithOrg, router } from "@repo/api/trpc";
import { db, schema } from "@repo/db/index";
import { and, desc, eq } from "drizzle-orm";

export const userRouter = router({
	initOrganization: authdProcedure.mutation(async ({ ctx }) => {
		const existingUserOrg = await db.query.member.findFirst({
			where: eq(schema.member.userId, ctx.user.id),
			columns: {
				organizationId: true,
			},
			with: {
				organization: {
					columns: {
						slug: true,
					},
				},
			},
			orderBy: desc(schema.member.createdAt),
		});

		if (existingUserOrg) {
			return {
				id: existingUserOrg.organizationId,
				slug: existingUserOrg.organization.slug,
			};
		}

		return await initialUserSetup(ctx.user.id);
	}),
	listInvitations: authdProcedureWithOrg.query(async ({ ctx }) => {
		const invitations = await db.query.invitation.findMany({
			where: and(
				eq(schema.invitation.email, ctx.user.email),
				eq(schema.invitation.status, "pending")
			),
			with: {
				organization: {
					columns: {
						name: true,
						logo: true,
					},
				},
			},
			columns: {
				id: true,
				expiresAt: true,
				role: true,
			},
		});

		return invitations;
	}),
});
