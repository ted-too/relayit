import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import z from "zod/v3"; // We will leave this as v3 for now see https://github.com/rhinobase/hono-openapi/issues/97

export const errorResponseSchema = z.object({
	details: z.array(z.string()),
	message: z.string(),
});

export const errorResponse = (
	c: Context,
	error: { status: ContentfulStatusCode; details: string[]; message: string }
) => c.json({ details: error.details, message: error.message }, error.status);
