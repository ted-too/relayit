import {
	ARRAY_DELIMITER,
	AVAILABLE_CHANNELS,
	AVAILABLE_MESSAGE_STATUSES,
	AVAILABLE_PROVIDER_TYPES,
} from "@repo/shared";
import { z } from "zod/v4";
import { createTimeRangedPaginatedSchema } from "./pagination";

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

export const messageFilterSchema = z.object({
	projectId: z.string().nullish(),
	recipient: z.string().nullish(),
	status: z.preprocess(
		// Convert string to array using ARRAY_DELIMITER
		(val) => {
			if (typeof val === "string") {
				return val.split(ARRAY_DELIMITER);
			}
			return val;
		},
		z.array(z.enum(AVAILABLE_MESSAGE_STATUSES)).nullish(),
	),
	channel: z.preprocess((val) => {
		if (typeof val === "string") {
			return val.split(ARRAY_DELIMITER);
		}
		return val;
	}, z.array(z.enum(AVAILABLE_CHANNELS)).nullish()),
	provider: z.preprocess((val) => {
		if (typeof val === "string") {
			return val.split(ARRAY_DELIMITER);
		}
		return val;
	}, z.array(z.enum(AVAILABLE_PROVIDER_TYPES)).nullish()),
});

export const getMessagesQuerySchema = createTimeRangedPaginatedSchema(
	messageFilterSchema.shape,
);

export type GetMessagesQueryInput = z.infer<typeof getMessagesQuerySchema>;
