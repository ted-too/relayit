import { authdProcedureWithOrg, router, verifyProject } from "@repo/api/trpc";
import { db, deepMerge, schema } from "@repo/db";
import {
	type UpdateProjectProviderConfig,
	createProjectProviderSchema,
	updateProjectProviderSchema,
} from "@repo/shared";
import { TRPCError } from "@trpc/server";
import { type SQL, and, desc, eq } from "drizzle-orm";
import { z } from "zod";

// TODO: Potentially add a middleware to check if the user has permission to access this resource

export const projectProviderAssociationRouter = router({
	create: authdProcedureWithOrg
		.concat(verifyProject)
		.input(
			z
				.object({
					providerCredentialId: z.string(),
				})
				.passthrough(),
		)
		.mutation(async ({ ctx, input }) => {
			const { organization, project } = ctx;
			const { providerCredentialId, projectId: _, ...baseConfig } = input;

			const orgProvider = await db.query.providerCredential.findFirst({
				columns: { id: true, channelType: true, providerType: true },
				where: and(
					eq(schema.providerCredential.id, providerCredentialId),
					eq(schema.providerCredential.organizationId, organization.id),
				),
			});

			if (!orgProvider) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message:
						"Provider credential not found or does not belong to this organization.",
				});
			}

			const specificProviderSchema = createProjectProviderSchema(
				orgProvider.channelType,
				orgProvider.providerType,
			);

			console.log(baseConfig);

			const validatedDataResult = specificProviderSchema.safeParse(baseConfig);

			if (validatedDataResult.error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Invalid provider configuration",
					cause: validatedDataResult.error.flatten(),
				});
			}

			try {
				const [newAssociation] = await db
					.insert(schema.projectProviderAssociation)
					.values({
						projectId: project.id,
						providerCredentialId,
						priority: validatedDataResult.data.priority,
						config: validatedDataResult.data.config,
					})
					.returning();

				if (!newAssociation) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Failed to create provider association",
					});
				}
				return newAssociation;
			} catch (error: any) {
				if (error.code === "23505") {
					throw new TRPCError({
						code: "CONFLICT",
						message:
							"This provider credential is already associated with this project.",
					});
				}
				console.error("Error creating project provider association:", error);
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "An unexpected error occurred.",
				});
			}
		}),
	list: authdProcedureWithOrg
		.concat(verifyProject)
		.query(async ({ ctx, input }) => {
			const { project } = ctx;

			const filters: SQL[] = [
				eq(schema.projectProviderAssociation.projectId, project.id),
			];

			const associations = await db.query.projectProviderAssociation.findMany({
				where: and(...filters),
				with: {
					providerCredential: {
						columns: {
							credentials: false,
						},
					},
				},
				orderBy: desc(schema.projectProviderAssociation.createdAt),
			});

			return associations;
		}),
	update: authdProcedureWithOrg
		.concat(verifyProject)
		.input(z.object({ associationId: z.string() }).passthrough())
		.mutation(async ({ ctx, input }) => {
			const { project } = ctx;
			const { associationId, projectId: _, ...validatedData } = input;

			if (Object.keys(validatedData).length === 0) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "No fields provided for update.",
				});
			}

			const association = await db.query.projectProviderAssociation.findFirst({
				where: and(
					eq(schema.projectProviderAssociation.id, associationId),
					eq(schema.projectProviderAssociation.projectId, project.id),
				),
				with: {
					providerCredential: {
						columns: {
							channelType: true,
							providerType: true,
						},
					},
				},
			});

			if (!association) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Provider association not found for this project.",
				});
			}

			const validatedDataResult = updateProjectProviderSchema(
				association.providerCredential.channelType,
				association.providerCredential.providerType,
				association.config !== null,
			).safeParse(validatedData);

			if (validatedDataResult.error) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Invalid provider configuration",
					cause: validatedDataResult.error.flatten(),
				});
			}

			const updatePayload: Partial<UpdateProjectProviderConfig> = {};
			if (validatedDataResult.data.priority !== undefined) {
				updatePayload.priority = validatedDataResult.data.priority;
			}
			if (validatedDataResult.data.config !== undefined) {
				updatePayload.config = association.config
					? deepMerge(association.config, validatedDataResult.data.config ?? {})
					: validatedDataResult.data.config;
			}

			if (Object.keys(updatePayload).length === 0) {
				return association;
			}

			const [updatedAssociation] = await db
				.update(schema.projectProviderAssociation)
				.set(updatePayload as any) // Using `as any` to bypass strict type checking for now, given the dynamic nature
				.where(
					and(
						eq(schema.projectProviderAssociation.id, associationId),
						eq(schema.projectProviderAssociation.projectId, project.id),
					),
				)
				.returning();

			if (!updatedAssociation) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Provider association not found during update.",
				});
			}

			return updatedAssociation;
		}),
	delete: authdProcedureWithOrg
		.concat(verifyProject)
		.input(z.object({ associationId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { project } = ctx;
			const { associationId } = input;

			const { rowCount } = await db
				.delete(schema.projectProviderAssociation)
				.where(
					and(
						eq(schema.projectProviderAssociation.id, associationId),
						eq(schema.projectProviderAssociation.projectId, project.id),
					),
				);

			if (rowCount === 0) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Provider association not found for this project.",
				});
			}

			return { message: "Provider association deleted successfully." };
		}),
});
