import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Context } from "@repo/api/index";
import { db, schema } from "@repo/db";
import { getProjectMessagesQuerySchema } from "@repo/shared";
import { HTTPException } from "hono/http-exception";
import { and, count, desc, eq, ilike, type SQL } from "drizzle-orm";

export const messagesRoutes = new Hono<Context>()
	// GET /messages - List messages for a project with filters & pagination
	.get("/", zValidator("query", getProjectMessagesQuerySchema), async (c) => {
		const { page, limit, status, channel, search, projectId } =
			c.req.valid("query");

		const organization = c.get("organization");

		if (projectId) {
			const project = await db.query.project.findFirst({
				where: and(
					eq(schema.project.id, projectId),
					eq(schema.project.organizationId, organization.id),
				),
				columns: {
					id: true,
				},
			});

			if (!project) {
				throw new HTTPException(404, { message: "Project not found" });
			}
		}

		const offset = (page - 1) * limit;

		const conditions: SQL[] = projectId
			? [eq(schema.message.projectId, projectId)]
			: [];

		if (status) {
			conditions.push(eq(schema.message.status, status));
		}
		if (channel) {
			conditions.push(eq(schema.message.channel, channel));
		}
		if (search) {
			conditions.push(ilike(schema.message.recipient, `%${search}%`));
		}

		const whereCondition = and(...conditions);

		const messages = await db
			.select()
			.from(schema.message)
			.where(whereCondition)
			.orderBy(desc(schema.message.createdAt))
			.limit(limit)
			.offset(offset);

		const totalResult = await db
			.select({ total: count() })
			.from(schema.message)
			.where(whereCondition);

		const totalItems = totalResult[0]?.total ?? 0;
		const totalPages = Math.ceil(totalItems / limit);

		return c.json({
			data: messages,
			pagination: {
				totalItems,
				totalPages,
				currentPage: page,
				pageSize: limit,
			},
		});
	});
