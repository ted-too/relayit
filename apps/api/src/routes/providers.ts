import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "@repo/api";
import {
	createProviderCredentialSchema,
	getProvidersQuerySchema,
	updateProviderCredentialSchema,
} from "@repo/shared";
import { db, schema } from "@repo/api/db";
import { eq, and, desc, isNull, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { encryptRecord, getSafeEncryptedRecord } from "@repo/api/lib/crypto";
import { generateProviderSlug } from "@repo/api/lib/slugs";

export const providerRoutes = new Hono<Context>()
	// POST /providers - Create new provider credentials (org or project specific)
	.post("/", zValidator("json", createProviderCredentialSchema), async (c) => {
		const organization = c.get("organization");
		const validatedData = c.req.valid("json");

		// If projectId is provided, ensure it belongs to the organization
		if (validatedData.projectId) {
			const project = await db.query.project.findFirst({
				columns: { id: true },
				where: and(
					eq(schema.project.id, validatedData.projectId),
					eq(schema.project.organizationId, organization.id),
				),
			});
			if (!project) {
				throw new HTTPException(400, {
					message: "Project not found in this organization",
				});
			}
		}

		const slug =
			validatedData.slug ??
			(await generateProviderSlug(
				validatedData.name,
				organization.id,
				validatedData.projectId,
			));

		// Final check for slug uniqueness in the specific scope
		const finalScopeCondition = validatedData.projectId
			? eq(schema.providerCredential.projectId, validatedData.projectId)
			: isNull(schema.providerCredential.projectId);

		const existingSlug = await db
			.select({ id: schema.providerCredential.id })
			.from(schema.providerCredential)
			.where(
				and(
					eq(schema.providerCredential.organizationId, organization.id),
					finalScopeCondition,
					eq(schema.providerCredential.slug, slug),
				),
			)
			.limit(1);

		if (existingSlug.length > 0) {
			throw new HTTPException(409, {
				message:
					"Slug already exists for this provider in the specified scope (organization or project)",
			});
		}

		// Access nested properties and encrypt credentials
		const encryptedCredentials = encryptRecord(validatedData.providerConfig.credentials);

		const [newCredential] = await db
			.insert(schema.providerCredential)
			.values({
				organizationId: organization.id,
				projectId: validatedData.projectId, // Will be null if not provided
				slug: slug,
				// Get channel and provider type from the nested config
				channelType: validatedData.providerConfig.channelType,
				providerType: validatedData.providerConfig.providerType,
				name: validatedData.name,
				credentials: encryptedCredentials,
				isActive: validatedData.isActive,
			})
			.returning();

		if (!newCredential) {
			throw new HTTPException(500, { message: "Failed to create credential" });
		}

		const safeCredential = {
			...newCredential,
			credentials: getSafeEncryptedRecord(newCredential.credentials),
		};

		return c.json(safeCredential, 201);
	})

	// GET /providers - List credentials for the organization
	.get("/", zValidator("query", getProvidersQuerySchema), async (c) => {
		const organization = c.get("organization");
		const validatedData = c.req.valid("query");

		const filters: SQL[] = [
			eq(schema.providerCredential.organizationId, organization.id),
		];

		if (validatedData.projectId) {
			filters.push(
				eq(schema.providerCredential.projectId, validatedData.projectId),
			);
		}

		const credentials = await db.query.providerCredential.findMany({
			where: and(...filters),
			orderBy: desc(schema.providerCredential.createdAt),
		});

		const safeCredentials = credentials.map((cred) => ({
			...cred,
			credentials: getSafeEncryptedRecord(cred.credentials),
		}));

		return c.json(safeCredentials);
	})

	// GET /providers/:providerId - Get specific credential
	.get("/:providerId", async (c) => {
		const organization = c.get("organization");
		const providerId = c.req.param("providerId");

		const credential = await db.query.providerCredential.findFirst({
			where: and(
				eq(schema.providerCredential.id, providerId),
				eq(schema.providerCredential.organizationId, organization.id),
			),
		});

		if (!credential) {
			throw new HTTPException(404, {
				message: "Provider credential not found",
			});
		}

		const safeCredential = {
			...credential,
			credentials: getSafeEncryptedRecord(credential.credentials),
		};

		return c.json(safeCredential);
	})

	// PATCH /providers/:providerId - Update credential by ID
	.patch(
		"/:providerId",
		zValidator("json", updateProviderCredentialSchema),
		async (c) => {
			const organization = c.get("organization");
			const providerId = c.req.param("providerId");
			const validatedData = c.req.valid("json");

			if (Object.keys(validatedData).length === 0) {
				throw new HTTPException(400, {
					message: "No fields provided for update",
				});
			}

			const existingCredential = await db.query.providerCredential.findFirst({
				where: and(
					eq(schema.providerCredential.id, providerId),
					eq(schema.providerCredential.organizationId, organization.id),
				),
			});

			if (!existingCredential) {
				throw new HTTPException(404, {
					message: "Provider credential not found",
				});
			}

			// Determine the scope for uniqueness checks (current or new projectId)
			const scopeProjectId =
				validatedData.projectId === undefined
					? existingCredential.projectId
					: validatedData.projectId;
			const scopeCondition = scopeProjectId
				? eq(schema.providerCredential.projectId, scopeProjectId)
				: isNull(schema.providerCredential.projectId);

			// If slug is being changed, check uniqueness in the relevant scope
			if (
				validatedData.slug &&
				validatedData.slug !== existingCredential.slug
			) {
				const slugCheck = await db
					.select({ id: schema.providerCredential.id })
					.from(schema.providerCredential)
					.where(
						and(
							eq(schema.providerCredential.organizationId, organization.id),
							scopeCondition,
							eq(schema.providerCredential.slug, validatedData.slug),
						),
					)
					.limit(1);

				if (slugCheck.length > 0 && slugCheck[0].id !== providerId) {
					throw new HTTPException(409, {
						message: "Slug already exists in the specified scope",
					});
				}
			}

			// If projectId is explicitly being changed, verify the new project exists in the org
			if (
				validatedData.projectId !== undefined &&
				validatedData.projectId !== existingCredential.projectId
			) {
				if (validatedData.projectId !== null) {
					// Allow changing to org-wide (null)
					const project = await db.query.project.findFirst({
						columns: { id: true },
						where: and(
							eq(schema.project.id, validatedData.projectId),
							eq(schema.project.organizationId, organization.id),
						),
					});
					if (!project) {
						throw new HTTPException(400, {
							message: "Target project not found in this organization",
						});
					}
				}
			}

			// Prepare update payload
			const updatePayload: Partial<typeof schema.providerCredential.$inferInsert> = {
				name: validatedData.name,
				slug: validatedData.slug,
				projectId: validatedData.projectId,
				isActive: validatedData.isActive,
			};

			if (validatedData.providerConfig) {
				// If providerConfig is part of the update, handle its fields
				// We don't allow changing channelType or providerType on update
				// updatePayload.channelType = validatedData.providerConfig.channelType;
				// updatePayload.providerType = validatedData.providerConfig.providerType;
				if (validatedData.providerConfig.credentials) {
					updatePayload.credentials = encryptRecord(
						validatedData.providerConfig.credentials,
					);
				}
			}

			// Remove any undefined keys to prevent overwriting existing values unintentionally
			for (const key of Object.keys(updatePayload)) {
				if (updatePayload[key as keyof typeof updatePayload] === undefined) {
					delete updatePayload[key as keyof typeof updatePayload];
				}
			}

			if (Object.keys(updatePayload).length === 0) {
				const safeExisting = {
					...existingCredential,
					credentials: getSafeEncryptedRecord(existingCredential.credentials),
				};
				return c.json(safeExisting); // No changes
			}

			const [updatedCredential] = await db
				.update(schema.providerCredential)
				.set(updatePayload) // Use the constructed payload
				.where(eq(schema.providerCredential.id, providerId))
				.returning();

			if (!updatedCredential) {
				throw new HTTPException(404, {
					message: "Credential not found during update",
				});
			}

			const safeCredential = {
				...updatedCredential,
				credentials: getSafeEncryptedRecord(updatedCredential.credentials),
			};

			return c.json(safeCredential);
		},
	)

	// DELETE /providers/:providerId - Delete credential by ID
	.delete("/:providerId", async (c) => {
		const organization = c.get("organization");
		const providerId = c.req.param("providerId");

		const { rowCount } = await db
			.delete(schema.providerCredential)
			.where(
				and(
					eq(schema.providerCredential.id, providerId),
					eq(schema.providerCredential.organizationId, organization.id),
				),
			);

		if (rowCount === 0) {
			throw new HTTPException(404, {
				message:
					"Provider credential not found or you do not have permission to delete it",
			});
		}

		return c.json({ message: "Provider credential deleted successfully" });
	});
