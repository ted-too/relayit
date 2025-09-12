import { z } from "zod";

const SAFE_STRING_REGEX = /^[a-zA-Z0-9_-]+$/;

export const safeString = z.string().regex(SAFE_STRING_REGEX, {
  message: "Only letters, numbers, underscores, and hyphens are allowed",
});
