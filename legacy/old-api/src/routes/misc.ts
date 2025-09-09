import { initialUserSetup } from "@repo/api/lib/auth";
import { generateOrganizationSlug } from "@repo/api/lib/slugs";
import { authdProcedure, authdProcedureWithOrg, router } from "@repo/api/trpc";
import { db, schema } from "@repo/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import z from "zod";

export const miscRouter = router({
  initOrganization: authdProcedure.mutation(async ({ ctx }) => {
    const { user } = ctx;

    const existingUserOrg = await db.query.member.findFirst({
      where: eq(schema.member.userId, user.id),
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

    if (existingUserOrg?.organization) {
      return {
        id: existingUserOrg.organizationId,
        slug: existingUserOrg.organization.slug,
      };
    }

    return await initialUserSetup(user.id);
  }),
  listMembers: authdProcedureWithOrg.query(async ({ ctx }) => {
    const data = await db.query.member.findMany({
      where: eq(schema.member.organizationId, ctx.session.activeOrganizationId),
      with: {
        user: {
          columns: {
            id: true,
            name: true,
            image: true,
            email: true,
          },
        },
      },
      columns: { id: true },
    });

    return data;
  }),
  listOrgInvitations: authdProcedureWithOrg.query(async ({ ctx }) => {
    const data = await db.query.invitation.findMany({
      where: and(
        eq(schema.invitation.organizationId, ctx.session.activeOrganizationId),
        inArray(schema.invitation.status, ["pending", "rejected"])
      ),
      with: {
        inviter: {
          columns: {
            id: true,
            name: true,
          },
        },
      },
    });

    return data;
  }),
  listInvitations: authdProcedureWithOrg.query(async ({ ctx }) => {
    const { user } = ctx;

    const invitations = await db.query.invitation.findMany({
      where: and(
        eq(schema.invitation.email, user.email),
        eq(schema.invitation.status, "pending")
      ),
      with: {
        organization: {
          columns: {
            name: true,
            logo: true,
          },
        },
        inviter: {
          columns: {
            id: true,
            name: true,
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
  generateOrgSlug: authdProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const slug = await generateOrganizationSlug(input.name);

      return { slug };
    }),
});
