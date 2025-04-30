import { z } from "zod";
import { AVAILABLE_CHANNELS, AVAILABLE_MESSAGE_STATUSES } from "@repo/shared";

export const createProjectSchema = z.object({
	name: z.string().min(1, "Name cannot be empty").optional(),
	slug: z
		.string()
		.regex(
			/^[a-zA-Z0-9-]+$/,
			"Only alphanumeric characters and hyphens are allowed",
		)
		.optional(),
	metadata: z.record(z.string(), z.any()).optional().nullable(),
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const updateProjectSchema = createProjectSchema.partial();

export type UpdateProjectInput = z.infer<typeof updateProjectSchema>;

export const getProjectMessagesQuerySchema = z.object({
	page: z.coerce.number().int().positive().optional().default(1),
	limit: z.coerce.number().int().positive().max(100).optional().default(20),
	status: z.enum(AVAILABLE_MESSAGE_STATUSES).optional(),
	channel: z.enum(AVAILABLE_CHANNELS).optional(),
	search: z.string().optional(),
});

export type GetProjectMessagesQueryInput = z.infer<
	typeof getProjectMessagesQuerySchema
>;
