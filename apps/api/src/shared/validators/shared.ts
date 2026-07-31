import { z } from "zod";

const SAFE_STRING_REGEX = /^[a-zA-Z0-9_.\s-]+$/;

export const safeString = z.string().regex(SAFE_STRING_REGEX, {
  message:
    "Only letters, numbers, underscores, spaces, and hyphens are allowed",
});

export const contactPropertiesSchema = z.record(z.string(), z.string());

export type ContactProperties = z.infer<typeof contactPropertiesSchema>;

/** API-key auth header used by transactional send routes. */
export const apiKeyHeadersSchema = z.object({
  "x-api-key": z.string().describe("The API key to use for the request."),
});

export type ApiKeyHeaders = z.infer<typeof apiKeyHeadersSchema>;

export const dynamicFormFieldsRegistry = z.registry<{
  description?: string;
  order?: number;
  placeholder?: string;
  title?: string;
  type?: "text" | "password" | "email" | "number" | "textarea" | "select";
}>();
