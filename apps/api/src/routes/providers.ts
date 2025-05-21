import { router, authdProcedureWithOrg } from "@repo/api/trpc";
import { z } from "zod";
import { generateProviderSlug } from "@repo/api/lib/slugs";
import { TRPCError } from "@trpc/server";
import { and, eq, desc, type SQL } from "drizzle-orm";
import { encryptRecord, getSafeEncryptedRecord, deepMerge } from "@repo/db";
import {
	AVAILABLE_CHANNELS,
	AVAILABLE_PROVIDER_TYPES,
	createProviderSchema,
	updateProviderSchema,
} from "@repo/shared";
import { db, schema } from "@repo/db";

export const providerRouter = router({
	generateSlug: authdProcedureWithOrg
		.input(z.object({ name: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { organization } = ctx;
			const slug = await generateProviderSlug(input.name, organization.id);
			return { slug };
		}),
	create: authdProcedureWithOrg
		.input(
			z
				.object({
					providerType: z.enum(AVAILABLE_PROVIDER_TYPES),
					channelType: z.enum(AVAILABLE_CHANNELS),
				})
				.passthrough(),
		)
		.mutation(async ({ ctx, input }) => {
			const { organization } = ctx;

			const parseSchema = createProviderSchema(
				input.channelType,
				input.providerType,
			);
			const parseResult = parseSchema.safeParse(input);

			if (!parseResult.success) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Invalid provider configuration",
					cause: parseResult.error.flatten(),
				});
			}

			const validatedData = parseResult.data;

			const slug =
				validatedData.slug ??
				(await generateProviderSlug(validatedData.name, organization.id));

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
				throw new TRPCError({
					code: "CONFLICT",
					message: "Slug already exists for this provider in the organization",
				});
			}

			const encryptedCredentialsResult = encryptRecord(
				validatedData.credentials,
			);

			if (encryptedCredentialsResult.error) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to encrypt credentials",
				});
			}

			const [newCredential] = await db
				.insert(schema.providerCredential)
				.values({
					organizationId: organization.id,
					slug: slug,
					channelType: validatedData.channelType,
					providerType: validatedData.providerType,
					name: validatedData.name,
					credentials: encryptedCredentialsResult.data,
					isActive: validatedData.isActive,
				})
				.returning();

			if (!newCredential) {
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: "Failed to create credential",
				});
			}

			const safeCredential = {
				...newCredential,
				credentials: getSafeEncryptedRecord(newCredential.credentials),
			};

			return safeCredential;
		}),
	list: authdProcedureWithOrg.query(async ({ ctx }) => {
		const { organization } = ctx;

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

		return safeCredentials;
	}),
	getById: authdProcedureWithOrg
		.input(z.object({ providerId: z.string() }))
		.query(async ({ ctx, input }) => {
			const { organization } = ctx;
			const { providerId } = input;

			const credential = await db.query.providerCredential.findFirst({
				where: and(
					eq(schema.providerCredential.id, providerId),
					eq(schema.providerCredential.organizationId, organization.id),
				),
			});

			if (!credential) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Provider credential not found",
				});
			}

			const safeCredential = {
				...credential,
				credentials: getSafeEncryptedRecord(credential.credentials),
			};

			return safeCredential;
		}),
	update: authdProcedureWithOrg
		.input(z.object({ providerId: z.string() }).passthrough())
		.mutation(async ({ ctx, input }) => {
			const { organization } = ctx;
			const { providerId, ...updateData } = input;

			const existingCredential = await db.query.providerCredential.findFirst({
				where: and(
					eq(schema.providerCredential.id, providerId),
					eq(schema.providerCredential.organizationId, organization.id),
				),
			});

			if (!existingCredential) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message: "Provider credential not found",
				});
			}

			const parseSchema = updateProviderSchema(
				existingCredential.channelType,
				existingCredential.providerType,
			);
			const parseResult = parseSchema.safeParse({
				...updateData,
				providerType: existingCredential.providerType,
				channelType: existingCredential.channelType,
			});

			if (!parseResult.success) {
				throw new TRPCError({
					code: "BAD_REQUEST",
					message: "Invalid provider configuration",
					cause: parseResult.error.flatten(),
				});
			}

			const validatedData = parseResult.data;

			const updatePayload: Partial<typeof existingCredential> = {};

			if (validatedData.name) {
				updatePayload.name = validatedData.name;
			}
			if (validatedData.isActive !== undefined) {
				updatePayload.isActive = validatedData.isActive;
			}

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
							eq(schema.providerCredential.slug, validatedData.slug),
						),
					)
					.limit(1);

				if (slugCheck.length > 0 && slugCheck[0].id !== providerId) {
					throw new TRPCError({
						code: "CONFLICT",
						message: "Slug already exists in the organization",
					});
				}
				updatePayload.slug = validatedData.slug;
			}

			if (validatedData.credentials) {
				const encryptedCredentialsResult = encryptRecord(
					validatedData.credentials,
				);
				if (encryptedCredentialsResult.error) {
					throw new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: "Failed to encrypt credentials",
					});
				}
				updatePayload.credentials = deepMerge(
					existingCredential.credentials,
					encryptedCredentialsResult.data,
				);
			}

			if (Object.keys(updatePayload).length === 0) {
				const safeExistingCredential = {
					...existingCredential,
					credentials: getSafeEncryptedRecord(existingCredential.credentials),
				};
				return safeExistingCredential;
			}

			const [updatedCredential] = await db
				.update(schema.providerCredential)
				.set(updatePayload)
				.where(eq(schema.providerCredential.id, providerId))
				.returning();

			if (!updatedCredential) {
				throw new TRPCError({
					code: "NOT_FOUND", // Should not happen if existingCredential was found
					message: "Credential not found during update",
				});
			}

			const safeCredential = {
				...updatedCredential,
				credentials: getSafeEncryptedRecord(updatedCredential.credentials),
			};

			return safeCredential;
		}),
	delete: authdProcedureWithOrg
		.input(z.object({ providerId: z.string() }))
		.mutation(async ({ ctx, input }) => {
			const { organization } = ctx;
			const { providerId } = input;

			const { rowCount } = await db
				.delete(schema.providerCredential)
				.where(
					and(
						eq(schema.providerCredential.id, providerId),
						eq(schema.providerCredential.organizationId, organization.id),
					),
				);

			if (rowCount === 0) {
				throw new TRPCError({
					code: "NOT_FOUND",
					message:
						"Provider credential not found or you do not have permission to delete it",
				});
			}

			return { message: "Provider credential deleted successfully" };
		}),
});
