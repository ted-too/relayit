import { z } from "zod";

const SAFE_STRING_REGEX = /^[a-zA-Z0-9_.\s-]+$/;

export const safeString = z.string().regex(SAFE_STRING_REGEX, {
  message:
    "Only letters, numbers, underscores, spaces, and hyphens are allowed",
});

/** Body for Project create — name only; slug is generated server-side. */
export const createProjectBodySchema = z.object({
  name: safeString,
});

export type CreateProjectBody = z.infer<typeof createProjectBodySchema>;
