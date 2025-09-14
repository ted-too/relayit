import { z } from "zod";

const SAFE_STRING_REGEX = /^[a-zA-Z0-9_.\s-]+$/;

export const safeString = z.string().regex(SAFE_STRING_REGEX, {
  message: "Only letters, numbers, underscores, spaces, and hyphens are allowed",
});
