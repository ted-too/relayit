import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "@repo/api/index";
import { apiKeyMiddleware } from "@repo/api/lib/middleware";
import { db, schema, queueMessage } from "@repo/db";
import { eq, and } from "drizzle-orm";
import { sendMessageSchema } from "@repo/shared";
import { HTTPException } from "hono/http-exception";

export const sendRouter = new Hono<Context>()
	.use(apiKeyMiddleware)
	.post("/", zValidator("json", sendMessageSchema), async (c) => {
		const body = c.req.valid("json");
		const apiKey = c.get("apiKey");
		const organization = c.get("organization");

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

		const provider = await db.query.projectProviderAssociation.findFirst({
			where: and(
				eq(schema.projectProviderAssociation.projectId, project.id),
				eq(schema.projectProviderAssociation.isActive, true),
			),
			with: {
				providerCredential: true,
			},
		});

		if (!provider?.providerCredential) {
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
						projectId: provider.projectId,
						apiKeyId: apiKey.id,
						projectProviderAssociationId: provider.id,
						channel: body.channel,
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
	});
