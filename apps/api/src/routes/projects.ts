import { createProjectSchema, updateProjectSchema } from "@repo/shared";
import { db, schema } from "@repo/db";
import { generateProjectSlug } from "@repo/api/lib/slugs";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { router, authdProcedureWithOrg, verifyProject } from "@repo/api/trpc";
import { TRPCError } from "@trpc/server";

export const projectRouter = router({
	list: authdProcedureWithOrg.query(async ({ ctx }) => {
		const { organization } = ctx;

		const projects = await db.query.project.findMany({
			where: eq(schema.project.organizationId, organization.id),
		});

		return projects;
	}),
	getById: authdProcedureWithOrg
		.concat(verifyProject)
		.query(async ({ ctx }) => {
			return ctx.project;
		}),
	update: authdProcedureWithOrg
		.concat(verifyProject)
		.input(updateProjectSchema)
		.mutation(async ({ ctx, input }) => {
			const { organization } = ctx;

			if (Object.keys(input).length === 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "No fields provided for update",
				});
			}

			if (input.slug) {
				const existingSlug = await db
					.select({ id: schema.project.id })
					.from(schema.project)
					.where(
						and(
							eq(schema.project.organizationId, organization.id),
							eq(schema.project.slug, input.slug),
						),
					)
					.limit(1);

				if (existingSlug.length > 0) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Project slug already exists in this organization",
					});
				}
			}

			input.metadata = input.metadata ?? null;

			if (Object.keys(input).length === 0) {
				return ctx.project;
			}

			const [updatedProject] = await db
				.update(schema.project)
				.set(input)
				.where(eq(schema.project.id, ctx.project.id))
				.returning();

			if (!updatedProject) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Project not found during update",
				});
			}

			return updatedProject;
		}),
	generateSlug: authdProcedureWithOrg
		.input(z.object({ name: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { organization } = ctx;

			const slug = await generateProjectSlug(input.name, organization.id);

			return { slug };
		}),
	create: authdProcedureWithOrg
		.input(createProjectSchema)
		.mutation(async ({ ctx, input }) => {
			const { organization } = ctx;

			const slug =
				input.slug ??
				(await generateProjectSlug(input.name ?? "untitled", organization.id));

			const existingSlug = await db
				.select({ id: schema.project.id })
				.from(schema.project)
				.where(
					and(
						eq(schema.project.organizationId, organization.id),
						eq(schema.project.slug, slug),
					),
				)
				.limit(1);

			if (existingSlug.length > 0) {
				throw new TRPCError({
					code: "CONFLICT",
					message: "Project slug already exists in this organization",
				});
			}

			const [newProject] = await db
				.insert(schema.project)
				.values({
					organizationId: organization.id,
					name: input.name ?? "Untitled Project",
					slug: slug,
					metadata: input.metadata ?? null,
				})
				.returning();

			if (!newProject) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create project",
				});
			}

			return newProject;
		}),
});
