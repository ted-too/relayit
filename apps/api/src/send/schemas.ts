import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import z from "zod";

export const successResponseSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "sent", "failed"]),
});

export const errorResponseSchema = z.object({
  details: z.array(z.string()),
  message: z.string(),
});

export const errorResponse = (
  c: Context,
  error: { status: ContentfulStatusCode; details: string[]; message: string }
) => c.json({ details: error.details, message: error.message }, error.status);
