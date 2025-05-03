import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "@repo/api";
import {
	createProjectProviderAssociationSchema,
	updateProjectProviderAssociationSchema,
	getProjectProviderAssociationsQuerySchema,
} from "@repo/shared";
import { db, schema } from "@repo/api/db";
import { eq, and, desc, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { verifyProject } from "@repo/api/lib/middleware";

// TODO: Potentially add a middleware to check if the user has permission to access this resource

export const projectProviderAssociationRoutes = new Hono<Context>()
	// POST /projects/provider-associations/:projectId - Link an org provider
	.post(
		"/:projectId",
		verifyProject,
		zValidator("json", createProjectProviderAssociationSchema),
		async (c) => {
			const organization = c.get("organization");
			const projectId = c.req.param("projectId");
			const validatedData = c.req.valid("json");

			// 1. Verify the providerCredential exists and belongs to the organization
			const orgProvider = await db.query.providerCredential.findFirst({
				columns: { id: true },
				where: and(
					eq(schema.providerCredential.id, validatedData.providerCredentialId),
					eq(schema.providerCredential.organizationId, organization.id),
				),
			});

			if (!orgProvider) {
				throw new HTTPException(400, {
					message:
						"Provider credential not found or does not belong to this organization.",
				});
			}

			// 2. Attempt to create the association
			try {
				const [newAssociation] = await db
					.insert(schema.projectProviderAssociation)
					.values({
						projectId: projectId,
						providerCredentialId: validatedData.providerCredentialId,
						isActive: validatedData.isActive, // Defaults handled by DB if undefined
						config: validatedData.config, // Add config if provided
					})
					.returning();

				if (!newAssociation) {
					throw new HTTPException(500, {
						message: "Failed to create provider association",
					});
				}
				return c.json(newAssociation, 201);
			} catch (error: any) {
				// Check for unique constraint violation (already associated)
				if (error.code === "23505") {
					// Postgres unique violation code
					throw new HTTPException(409, {
						message:
							"This provider credential is already associated with this project.",
					});
				}
				// Log other errors if needed
				console.error("Error creating project provider association:", error);
				throw new HTTPException(500, {
					message: "An unexpected error occurred.",
				});
			}
		},
	)

	// GET /projects/provider-associations/:projectId - List associated providers
	.get(
		"/:projectId",
		verifyProject,
		zValidator("query", getProjectProviderAssociationsQuerySchema),
		async (c) => {
			const projectId = c.req.param("projectId");
			const { isActive } = c.req.valid("query");

			const filters: SQL[] = [
				eq(schema.projectProviderAssociation.projectId, projectId),
			];

			if (isActive !== undefined) {
				filters.push(eq(schema.projectProviderAssociation.isActive, isActive));
			}

			// Fetch associations and join with provider credential details
			const associations = await db.query.projectProviderAssociation.findMany({
				where: and(...filters),
				with: {
					providerCredential: {
						columns: {
							// Exclude raw credentials
							credentials: false,
						},
					},
				},
				orderBy: desc(schema.projectProviderAssociation.createdAt),
			});

			// Note: Joined providerCredential data will NOT have credentials field
			return c.json(associations);
		},
	)

	// PATCH /projects/provider-associations/:projectId/:associationId - Update association
	.patch(
		"/:projectId/:associationId",
		verifyProject,
		zValidator("json", updateProjectProviderAssociationSchema),
		async (c) => {
			const projectId = c.req.param("projectId");
			const associationId = c.req.param("associationId");
			const validatedData = c.req.valid("json");

			if (Object.keys(validatedData).length === 0) {
				throw new HTTPException(400, {
					message: "No fields provided for update.",
				});
			}

			// Prepare update payload, removing undefined keys
			const updatePayload: Partial<
				typeof schema.projectProviderAssociation.$inferInsert
			> = {};
			if (validatedData.isActive !== undefined) {
				updatePayload.isActive = validatedData.isActive;
			}
			if (validatedData.config !== undefined) {
				updatePayload.config = validatedData.config;
			}

			if (Object.keys(updatePayload).length === 0) {
				// Should not happen due to initial check, but good practice
				throw new HTTPException(400, {
					message: "No valid fields provided for update.",
				});
			}

			const [updatedAssociation] = await db
				.update(schema.projectProviderAssociation)
				.set(updatePayload)
				.where(
					and(
						eq(schema.projectProviderAssociation.id, associationId),
						eq(schema.projectProviderAssociation.projectId, projectId), // Ensure it belongs to the correct project
					),
				)
				.returning();

			if (!updatedAssociation) {
				throw new HTTPException(404, {
					message: "Provider association not found for this project.",
				});
			}

			return c.json(updatedAssociation);
		},
	)

	// DELETE /projects/provider-associations/:projectId/:associationId - Unlink provider
	.delete("/:projectId/:associationId", async (c) => {
		const projectId = c.req.param("projectId");
		const associationId = c.req.param("associationId");

		const { rowCount } = await db
			.delete(schema.projectProviderAssociation)
			.where(
				and(
					eq(schema.projectProviderAssociation.id, associationId),
					eq(schema.projectProviderAssociation.projectId, projectId), // Ensure it belongs to the correct project
				),
			);

		if (rowCount === 0) {
			throw new HTTPException(404, {
				message: "Provider association not found for this project.",
			});
		}

		return c.json({ message: "Provider association deleted successfully." });
	});
