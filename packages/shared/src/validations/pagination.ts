import { z } from "zod/v4";
import { ARRAY_DELIMITER } from "../constants/validations";

export const basePaginationSchema = z.object({
	limit: z.number().min(1).max(100).nullish(),
	cursor: z.number().nullish(), // <-- "cursor" needs to exist, but can be any type
	direction: z.enum(["forward", "backward"]), // optional, useful for bi-directional query
});

const transformTimestamp = (val: number | string | Date | undefined | null) => {
	if (val === undefined || val === null) return null;
	if (typeof val === "number") return val;
	// If it's a Date object or string, convert to timestamp
	return new Date(val).getTime();
};

export const timeRangeSchema = z.object({
	start: z.coerce.number().nullish().transform(transformTimestamp),
	end: z.coerce.number().nullish().transform(transformTimestamp),
});

export function createTimeRangedPaginatedSchema<T extends z.ZodRawShape>(
	extraFields: T,
) {
	return timeRangeSchema.extend({
		id: z.preprocess(
			(val) => {
				if (typeof val === "string") {
					return val.split(ARRAY_DELIMITER);
				}
				return val;
			},
			z.array(z.string()).nullish(),
		),
		search: z.string().nullish(),
		sort: z.array(z.string()).nullish(), // will be in the format of <column_id>:<asc|desc>
		...basePaginationSchema.shape,
		...extraFields,
	});
}
