import { generateProjectSlug } from "@repo/api/lib/slugs";
import { authdProcedureWithOrg, router, verifyProject } from "@repo/api/trpc";
import type { ProjectDetails } from "@repo/db";
import { db, schema } from "@repo/db";
import { createProjectSchema, updateProjectSchema } from "@repo/shared";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";

export const projectRouter = router({
	list: authdProcedureWithOrg.query(async ({ ctx }) => {
		const { organization } = ctx;

		const projects = await db.query.project.findMany({
			where: eq(schema.project.organizationId, organization.id),
			with: {
				providerAssociations: {
					columns: {
						id: true,
					},
				},
			},
		});

		return projects;
	}),
	getById: authdProcedureWithOrg
		.concat(verifyProject)
		.query(async ({ ctx }) => {
			const project = await db.query.project.findFirst({
				where: eq(schema.project.id, ctx.project.id),
				with: {
					providerAssociations: {
						with: {
							providerCredential: {
								columns: {
									channelType: true,
									providerType: true,
								},
							},
						},
					},
				},
			});

			if (!project) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Project not found",
				});
			}

			return project satisfies ProjectDetails;
		}),
	getBySlug: authdProcedureWithOrg
		.input(z.object({ slug: z.string() }))
		.query(async ({ ctx, input }) => {
			const project = await db.query.project.findFirst({
				where: and(
					eq(schema.project.slug, input.slug),
					eq(schema.project.organizationId, ctx.organization.id)
				),
				with: {
					providerAssociations: {
						with: {
							providerCredential: {
								columns: {
									channelType: true,
									providerType: true,
								},
							},
						},
					},
				},
			});

			if (!project) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Project not found",
				});
			}

			return project satisfies ProjectDetails;
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
							eq(schema.project.slug, input.slug)
						)
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
						eq(schema.project.slug, slug)
					)
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
					slug,
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
	delete: authdProcedureWithOrg
		.concat(verifyProject)
		.mutation(async ({ ctx }) => {
			await db
				.delete(schema.project)
				.where(eq(schema.project.id, ctx.project.id));
		}),
});
