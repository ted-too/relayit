import { authdProcedureWithOrg, router } from "@repo/api/trpc";
import { db, schema } from "@repo/db";
import { getProjectMessagesQuerySchema } from "@repo/shared";
import { type SQL, and, count, desc, eq, ilike } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

export const messagesRouter = router({
	list: authdProcedureWithOrg
		.input(getProjectMessagesQuerySchema)
		.query(async ({ ctx, input }) => {
			const { page, limit, status, channel, search, projectId } = input;

			if (projectId) {
				const project = await db.query.project.findFirst({
					where: and(
						eq(schema.project.id, projectId),
						eq(schema.project.organizationId, ctx.session.activeOrganizationId),
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

			return {
				data: messages,
				pagination: {
					totalItems,
					totalPages,
					currentPage: page,
					pageSize: limit,
				},
			};
		}),
});
