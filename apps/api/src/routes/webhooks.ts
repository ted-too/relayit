import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "@repo/api";
import {
	createWebhookEndpointSchema,
	updateWebhookEndpointSchema,
} from "@repo/shared";
import { db, schema } from "@repo/db";
import { eq, and, desc } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";
import { encrypt, redactedString } from "@repo/db";
import { verifyProject } from "@repo/api/lib/middleware";

export const webhookRoutes = new Hono<Context>()
	// POST /webhooks/:projectId - Create new webhook endpoint for the project in context
	.post(
		"/:projectId",
		verifyProject,
		zValidator("json", createWebhookEndpointSchema),
		async (c) => {
			const projectId = c.req.param("projectId"); // Get projectId from the path param
			const validatedData = c.req.valid("json");

			let secret = null;
			if (validatedData.secret) {
				const encryptedSecret = encrypt(validatedData.secret);
				if (encryptedSecret.error) {
					throw new HTTPException(500, {
						message: "Failed to encrypt secret",
					});
				}
				secret = encryptedSecret.data;
			}

			const [newWebhook] = await db
				.insert(schema.webhookEndpoint)
				.values({
					projectId: projectId, // Use projectId
					url: validatedData.url,
					secret,
					eventTypes: validatedData.eventTypes,
					isActive: validatedData.isActive,
				})
				.returning();

			const safeWebhook = {
				...newWebhook,
				secret: secret ? redactedString : null,
			};

			return c.json(safeWebhook, 201);
		},
	)
	// GET /webhooks/:projectId - List webhooks for the project in context
	.get("/:projectId", verifyProject, async (c) => {
		const projectId = c.req.param("projectId");

		const webhooks = await db.query.webhookEndpoint.findMany({
			where: eq(schema.webhookEndpoint.projectId, projectId), // Use projectId
			orderBy: desc(schema.webhookEndpoint.createdAt),
		});

		const safeWebhooks = webhooks.map((webhook) => ({
			...webhook,
			secret: webhook.secret ? redactedString : null,
		}));

		return c.json(safeWebhooks);
	})
	// GET /webhooks/:projectId/:webhookId - Get specific webhook for the project
	.get("/:projectId/:webhookId", verifyProject, async (c) => {
		const projectId = c.req.param("projectId");
		const webhookId = c.req.param("webhookId");

		const webhook = await db.query.webhookEndpoint.findFirst({
			where: and(
				eq(schema.webhookEndpoint.id, webhookId),
				eq(schema.webhookEndpoint.projectId, projectId), // Use projectId
			),
		});

		if (!webhook) {
			throw new HTTPException(404, { message: "Webhook endpoint not found" });
		}

		const safeWebhook = {
			...webhook,
			secret: webhook.secret ? redactedString : null,
		};

		return c.json(safeWebhook);
	})
	// PATCH /webhooks/:projectId/:webhookId - Update webhook for the project
	.patch(
		"/:projectId/:webhookId",
		verifyProject,
		zValidator("json", updateWebhookEndpointSchema),
		async (c) => {
			const projectId = c.req.param("projectId");
			const webhookId = c.req.param("webhookId");
			const validatedData = c.req.valid("json");

			// First check if the webhook exists and belongs to the project
			const existingWebhook = await db.query.webhookEndpoint.findFirst({
				columns: { id: true }, // Only need id to confirm existence
				where: and(
					eq(schema.webhookEndpoint.id, webhookId),
					eq(schema.webhookEndpoint.projectId, projectId), // Use projectId
				),
			});

			if (!existingWebhook) {
				throw new HTTPException(404, {
					message: "Webhook endpoint not found for this project",
				});
			}

			// Prepare update payload
			const updatePayload: Partial<typeof schema.webhookEndpoint.$inferInsert> =
				{};
			if (validatedData.url) updatePayload.url = validatedData.url;
			if (validatedData.eventTypes)
				updatePayload.eventTypes = validatedData.eventTypes;
			if (validatedData.isActive !== undefined)
				updatePayload.isActive = validatedData.isActive;
			if (validatedData.secret !== undefined) {
				const encryptedSecret = encrypt(validatedData.secret);
				if (encryptedSecret.error) {
					throw new HTTPException(500, {
						message: "Failed to encrypt secret",
					});
				}
				updatePayload.secret = encryptedSecret.data;
			}

			if (Object.keys(updatePayload).length === 0) {
				// If no fields to update, return the existing (but safe) webhook data
				// Fetch full existing data if we need to return it
				const fullExisting = await db.query.webhookEndpoint.findFirst({
					where: eq(schema.webhookEndpoint.id, webhookId),
				});
				if (!fullExisting)
					throw new HTTPException(404, { message: "Webhook not found" }); // Should not happen
				return c.json({
					...fullExisting,
					secret: fullExisting.secret ? redactedString : null,
				});
			}

			const [updatedWebhook] = await db
				.update(schema.webhookEndpoint)
				.set(updatePayload)
				.where(
					// Redundant check, but safe
					and(
						eq(schema.webhookEndpoint.id, webhookId),
						eq(schema.webhookEndpoint.projectId, projectId), // Use projectId
					),
				)
				.returning();

			if (!updatedWebhook) {
				throw new HTTPException(404, {
					message: "Webhook endpoint not found during update",
				});
			}

			const safeWebhook = {
				...updatedWebhook,
				secret: updatedWebhook.secret ? redactedString : null,
			};

			return c.json(safeWebhook);
		},
	)
	// DELETE /webhooks/:projectId/:webhookId - Delete webhook for the project
	.delete("/:projectId/:webhookId", verifyProject, async (c) => {
		const projectId = c.req.param("projectId");
		const webhookId = c.req.param("webhookId");

		const { rowCount } = await db.delete(schema.webhookEndpoint).where(
			and(
				eq(schema.webhookEndpoint.id, webhookId),
				eq(schema.webhookEndpoint.projectId, projectId), // Use projectId
			),
		);

		if (rowCount === 0) {
			throw new HTTPException(404, {
				message:
					"Webhook endpoint not found or already deleted for this project",
			});
		}

		return c.json({ message: "Webhook deleted successfully" });
	});
