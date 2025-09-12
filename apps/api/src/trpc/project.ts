import { schema } from "@repo/shared/db";
import {
  createOrganizationSchema,
  updateOrganizationSchema,
} from "@repo/shared/forms";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { generateDbSlug, isSlugTaken } from "@/lib/slug";
import { authdOrganizationProcedure, authdProcedure, router } from ".";

export const projectRouter = router({
  checkSlug: authdProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input }) => {
      const slugTaken = await isSlugTaken(schema.organization, input.slug);

      return { exists: slugTaken };
    }),
  generateSlug: authdProcedure
    .input(z.object({ name: z.string() }))
    .mutation(async ({ input }) => {
      const slug = await generateDbSlug(schema.organization, input.name);
      return { slug };
    }),
  create: authdProcedure
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

      return {
        id: data.id,
        name: data.name,
        slug: data.slug,
      };
    }),
  update: authdOrganizationProcedure
    .input(updateOrganizationSchema)
    .mutation(async ({ ctx, input }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: ctx.req.headers,
        body: {
          permissions: {
            organization: ["update"],
          },
        },
      });

      if (!hasPermission) {
        throw new TRPCError({ code: "FORBIDDEN", message: "You do not have permission to update organizations" });
      }

      if (input.slug && input.slug !== ctx.session.activeOrganization.slug) {
        const slugTaken = await isSlugTaken(schema.organization, input.slug);

        if (slugTaken) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Slug already taken",
          });
        }
      }

      const data = await auth.api.updateOrganization({
        body: {
          data: {
            name: input.name,
            slug: input.slug,
            logo: input.logo ?? undefined,
          },
          organizationId: ctx.session.activeOrganization.id,
        },
        headers: ctx.req.headers,
      });

      if (!data) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });

      return {
        id: data.id,
        name: data.name,
        slug: data.slug,
        logo: data.logo,
      };
    }),
});
