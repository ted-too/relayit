import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "@repo/api";
import {
	AVAILABLE_CHANNELS,
	AVAILABLE_PROVIDER_TYPES,
	createProviderSchema,
	updateProviderSchema,
} from "@repo/shared";
import { db, schema } from "@repo/db";
import { eq, and, desc, type SQL } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { deepMerge, encryptRecord, getSafeEncryptedRecord } from "@repo/db";
import { generateProviderSlug } from "@repo/api/lib/slugs";
import { z } from "zod";

export const providerRoutes = new Hono<Context>()
	.post(
		"/generate-slug",
		zValidator("json", z.object({ name: z.string() })),
		async (c) => {
			const validatedData = c.req.valid("json");
			const organization = c.get("organization");

			const slug = await generateProviderSlug(
				validatedData.name,
				organization.id,
			);

			return c.json({ slug });
		},
	)
	// POST /providers - Create new ORGANIZATION provider credentials
	.post(
		"/",
		zValidator(
			"json",
			z
				.object({
					providerType: z.enum(AVAILABLE_PROVIDER_TYPES),
					channelType: z.enum(AVAILABLE_CHANNELS),
				})
				.passthrough(),
		),
		async (c) => {
			const organization = c.get("organization");
			const body = c.req.valid("json");

			const parseSchema = createProviderSchema(
				body.channelType,
				body.providerType,
			);
			const parseResult = parseSchema.safeParse(body);

			if (!parseResult.success) {
				throw new HTTPException(400, {
					message: "Invalid provider configuration",
				});
			}

			const validatedData = parseResult.data;

			const slug =
				validatedData.slug ??
				(await generateProviderSlug(validatedData.name, organization.id));

			// Final check for slug uniqueness in the ORGANIZATION scope
			const existingSlug = await db
				.select({ id: schema.providerCredential.id })
				.from(schema.providerCredential)
				.where(
					and(
						eq(schema.providerCredential.organizationId, organization.id),
						eq(schema.providerCredential.slug, slug),
					),
				)
				.limit(1);

			if (existingSlug.length > 0) {
				throw new HTTPException(409, {
					message: "Slug already exists for this provider in the organization",
				});
			}

			// Access nested properties and encrypt credentials
			const encryptedCredentialsResult = encryptRecord(
				validatedData.credentials,
			);

			if (encryptedCredentialsResult.error) {
				throw new HTTPException(500, {
					message: "Failed to encrypt credentials",
				});
			}

			const [newCredential] = await db
				.insert(schema.providerCredential)
				.values({
					organizationId: organization.id,
					slug: slug,
					// Get channel and provider type from the nested config
					channelType: validatedData.channelType,
					providerType: validatedData.providerType,
					name: validatedData.name,
					credentials: encryptedCredentialsResult.data,
					isActive: validatedData.isActive,
				})
				.returning();

			if (!newCredential) {
				throw new HTTPException(500, {
					message: "Failed to create credential",
				});
			}

			const safeCredential = {
				...newCredential,
				credentials: getSafeEncryptedRecord(newCredential.credentials),
			};

			return c.json(safeCredential, 201);
		},
	)

	// GET /providers - List credentials for the organization
	.get("/", async (c) => {
		const organization = c.get("organization");

		const filters: SQL[] = [
			eq(schema.providerCredential.organizationId, organization.id),
		];

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
	.patch("/:providerId", zValidator("json", z.any()), async (c) => {
		const organization = c.get("organization");
		const providerId = c.req.param("providerId");

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

		const body = c.req.valid("json");

		const parseSchema = updateProviderSchema(
			existingCredential.channelType,
			existingCredential.providerType,
		);
		const parseResult = parseSchema.safeParse({
			...body,
			providerType: existingCredential.providerType,
			channelType: existingCredential.channelType,
		});

		if (!parseResult.success) {
			throw new HTTPException(400, {
				message: "Invalid provider configuration",
			});
		}

		const validatedData = parseResult.data;

		// If slug is being changed, check uniqueness in the ORGANIZATION scope
		if (validatedData.slug && validatedData.slug !== existingCredential.slug) {
			const slugCheck = await db
				.select({ id: schema.providerCredential.id })
				.from(schema.providerCredential)
				.where(
					and(
						eq(schema.providerCredential.organizationId, organization.id),
						eq(schema.providerCredential.slug, validatedData.slug),
					),
				)
				.limit(1);

			if (slugCheck.length > 0 && slugCheck[0].id !== providerId) {
				throw new HTTPException(409, {
					message: "Slug already exists in the organization",
				});
			}
		}

		if (validatedData.credentials) {
			const encryptedCredentialsResult = encryptRecord(
				validatedData.credentials,
			);
			if (encryptedCredentialsResult.error) {
				throw new HTTPException(500, {
					message: "Failed to encrypt credentials",
				});
			}
			validatedData.credentials = deepMerge(
				existingCredential.credentials,
				encryptedCredentialsResult.data,
			);
		}

		const [updatedCredential] = await db
			.update(schema.providerCredential)
			// @ts-expect-error - TODO: fix this
			.set(validatedData)
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
	})

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
