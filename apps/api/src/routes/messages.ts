import { authdProcedureWithOrg, router } from "@repo/api/trpc";
import { db, schema } from "@repo/db";
import {
	getFacetsFromData,
	getMessagesQuerySchema,
	messageFilterSchema,
	zodKeys,
} from "@repo/shared";
import {
	type SQL,
	and,
	count,
	desc,
	eq,
	gt,
	ilike,
	inArray,
	lt,
	or,
} from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

export const messagesRouter = router({
	list: authdProcedureWithOrg
		.input(getMessagesQuerySchema)
		.query(async ({ ctx, input }) => {
			const { direction, cursor, status, id, channel, search, projectId } =
				input;

			const limit = input.limit ?? 50;

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

			const conditions: SQL[] = projectId
				? [eq(schema.message.projectId, projectId)]
				: [];

			const idCondition = id ? inArray(schema.message.id, id) : undefined;

			if (cursor) {
				try {
					const cursorDate = new Date(cursor);
					conditions.push(
						direction === "backward"
							? lt(schema.message.createdAt, cursorDate)
							: gt(schema.message.createdAt, cursorDate),
					);
				} catch (error) {
					console.warn("Invalid cursor", error);
				}
			}

			const totalRowCount =
				(
					await db
						.select({ total: count() })
						.from(schema.message)
						.where(or(idCondition, and(...conditions)))
				)?.[0]?.total ?? 0;

			if (status) {
				conditions.push(inArray(schema.message.status, status));
			}
			if (channel) {
				conditions.push(inArray(schema.message.channel, channel));
			}
			if (search) {
				conditions.push(ilike(schema.message.recipient, `%${search}%`));
			}

			const whereCondition = or(idCondition, and(...conditions));

			// const items = await db
			// 	.select()
			// 	.from(schema.message)
			// 	.where(whereCondition)
			// 	.orderBy(desc(schema.message.createdAt))
			// 	.limit(limit);
			const items = await db.query.message.findMany({
				where: whereCondition,
				orderBy: desc(schema.message.createdAt),
				limit,
				with: {
					project: {
						columns: {
							name: true,
						},
					},
				},
			});

			const totalFilteredRowCount =
				(
					await db
						.select({ total: count() })
						.from(schema.message)
						.where(whereCondition)
				)?.[0]?.total ?? 0;

			let nextCursor: typeof cursor | undefined = undefined;
			if (items.length > limit) {
				const nextItem = items.pop();
				nextCursor = nextItem!.createdAt.getTime();
			}

			const facets = getFacetsFromData(items, zodKeys(messageFilterSchema));

			return {
				items,
				facets,
				nextCursor,
				totalRowCount,
				totalFilteredRowCount,
			};

			// const totalItems = totalResult[0]?.total ?? 0;
			// const totalPages = Math.ceil(totalItems / limit);

			// return {
			// 	data: messages,
			// 	pagination: {
			// 		totalItems,
			// 		totalPages,
			// 		currentPage: page,
			// 		pageSize: limit,
			// 	},
			// };
		}),
});
