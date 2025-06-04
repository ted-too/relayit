import type { Context } from "@repo/api/index";
import { apiKeyMiddleware } from "@repo/api/lib/middleware";
import { db, queueMessage, schema } from "@repo/db";
import { sendMessageSchema } from "@repo/shared";
import { and, asc, eq, type SQL } from "drizzle-orm";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { resolver, validator as zValidator } from "hono-openapi/zod";
import { HTTPException } from "hono/http-exception";
import z from "zod/v4";
import { errorResponseSchema } from "@repo/api/lib/error-response";

export const sendRouter = new Hono<Context>().use(apiKeyMiddleware).post(
	"/",
	describeRoute({
		description: "Send a message to a recipient",
		responses: {
			201: {
				description: "Successful response",
				content: {
					"application/json": {
						schema: resolver(
							z.object({
								id: z.string(),
								status: z.enum(["queued", "sent", "failed"]),
							}),
						),
					},
				},
			},
			400: {
				description: "Bad request",
				content: {
					"application/json": {
						schema: resolver(errorResponseSchema),
					},
				},
			},
			404: {
				description: "Not found",
				content: {
					"application/json": {
						schema: resolver(errorResponseSchema),
					},
				},
			},
			500: {
				description: "Internal server error",
				content: {
					"application/json": {
						schema: resolver(errorResponseSchema),
					},
				},
			},
		},
	}),
	zValidator("json", sendMessageSchema),
	async (c) => {
		const body = c.req.valid("json");
		const apiKey = c.get("apiKey");
		const organization = c.get("organization");

		console.log(apiKey);
		console.log(organization);

		const project = await db.query.project.findFirst({
			where: and(
				eq(schema.project.slug, body.projectSlug),
				eq(schema.project.organizationId, organization.id),
			),
		});

		if (!project) {
			throw new HTTPException(404, {
				message: "Project not found",
			});
		}

		const providerConditions: SQL[] = [
			eq(schema.providerCredential.channelType, body.channel),
		];

		if (body.providerType) {
			providerConditions.push(
				eq(schema.providerCredential.providerType, body.providerType),
			);
		}

		const providers = await db.query.projectProviderAssociation.findFirst({
			where: and(eq(schema.projectProviderAssociation.projectId, project.id)),
			with: {
				providerCredential: true,
			},
			orderBy: [asc(schema.projectProviderAssociation.priority)],
		});

		if (!providers?.providerCredential) {
			return c.json(
				{
					error: "No active provider found for the specified channel",
				},
				400,
			);
		}

		// Create message record and queue it atomically
		try {
			const newMessage = await db.transaction(async (tx) => {
				const [newMessage] = await tx
					.insert(schema.message)
					.values({
						projectId: providers.projectId,
						apiKeyId: apiKey.id,
						channel: body.channel,
						providerType: providers.providerCredential.providerType,
						recipient: body.recipient,
						payload: body.payload,
						status: "queued",
					})
					.returning();

				await queueMessage(newMessage.id);

				return newMessage;
			});

			return c.json(
				{
					id: newMessage.id,
					status: "queued",
				},
				201,
			);
		} catch (error) {
			console.error("Error processing /send request:", error);
			throw new HTTPException(500, {
				message: `Failed to process send request: ${error instanceof Error ? error.message : "Unknown error"}`,
				cause: error,
			});
		}
	},
);
