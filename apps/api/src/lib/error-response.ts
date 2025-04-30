import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export const errorResponse = (
	c: Context,
	error: { status: ContentfulStatusCode; details: string[]; message: string },
) => c.json({ details: error.details, message: error.message }, error.status);
