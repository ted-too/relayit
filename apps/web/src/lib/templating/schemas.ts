import { z } from "zod";
import { safeString } from "@/lib/projects/schemas";

export const createTemplateFormSchema = z.object({
  name: safeString.min(1).max(256),
});

export const createTemplateInputSchema = createTemplateFormSchema.extend({
  orgSlug: z.string().min(1),
});

export const listTemplatesInputSchema = z.object({
  orgSlug: z.string().min(1),
});

export const getTemplateInputSchema = z.object({
  orgSlug: z.string().min(1),
  templateId: z.string().min(1),
});

export const archiveTemplateInputSchema = getTemplateInputSchema;

export const updateTemplateSlugFormSchema = z.object({
  slug: safeString.min(1).max(128),
});

export const updateTemplateSlugInputSchema =
  updateTemplateSlugFormSchema.extend({
    orgSlug: z.string().min(1),
    templateId: z.string().min(1),
  });

export const putReactEmailChannelInputSchema = z.object({
  orgSlug: z.string().min(1),
  subject: z.string().min(1).max(998),
  templateId: z.string().min(1),
  workspaceEntryId: z.string().min(1),
});

export const listWorkspaceEntriesInputSchema = z.object({
  kind: z.literal("reactEmail"),
  orgSlug: z.string().min(1),
});

export const getWorkspaceInputSchema = listWorkspaceEntriesInputSchema;

export const listWorkspaceFilesInputSchema = listWorkspaceEntriesInputSchema;

export const readWorkspaceFileInputSchema = z.object({
  kind: z.literal("reactEmail"),
  orgSlug: z.string().min(1),
  path: z.string().min(1),
});

export const commitWorkspaceFilesInputSchema = z.object({
  changes: z.record(z.string(), z.string().nullable()),
  kind: z.literal("reactEmail"),
  message: z.string().min(1).max(512).optional(),
  orgSlug: z.string().min(1),
});

export const workspaceIdOnlyInputSchema = z.object({
  kind: z.literal("reactEmail"),
  orgSlug: z.string().min(1),
});

export const previewWorkspaceEntryInputSchema = z.object({
  entryId: z.string().min(1),
  kind: z.literal("reactEmail"),
  orgSlug: z.string().min(1),
  props: z.record(z.string(), z.unknown()).optional(),
  subject: z.string().max(998).optional(),
});

export type CreateTemplateFormValues = z.infer<typeof createTemplateFormSchema>;
export type UpdateTemplateSlugFormValues = z.infer<
  typeof updateTemplateSlugFormSchema
>;
