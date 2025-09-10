import { auth } from "@repo/api/lib/auth";
import { generateDbSlug } from "@repo/api/lib/slug";
import { db, schema } from "@repo/shared/db";
import { createOrganizationSchema } from "@repo/shared/forms";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { authdProcedure, router } from ".";

export const authRouter = router({
  createProject: authdProcedure
    .input(createOrganizationSchema)
    .mutation(async ({ ctx, input }) => {
      const slug = await generateDbSlug(schema.organization, input.name);

      const data = await auth.api.createOrganization({
        body: {
          name: input.name,
          slug,
          userId: ctx.user.id,
          keepCurrentActiveOrganization: false,
        },
        headers: ctx.req.headers,
      });

      if (!data) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      const organization = (await db.query.organization.findFirst({
        where: eq(schema.organization.id, data.id),
      }))!;

      return organization;
    }),
});
