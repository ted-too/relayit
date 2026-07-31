import { AVAILABLE_TEMPLATING_WORKSPACE_KINDS } from "@repo/api/db/schema/templating/workspace";
import { z } from "zod";

export const templatingWorkspaceKindParamsSchema = z.object({
  kind: z.enum(AVAILABLE_TEMPLATING_WORKSPACE_KINDS),
});

export type TemplatingWorkspaceKindParams = z.infer<
  typeof templatingWorkspaceKindParamsSchema
>;

export const templatingWorkspaceFileParamsSchema =
  templatingWorkspaceKindParamsSchema.extend({
    "*": z.string().min(1),
  });

export const templatingWorkspaceEntryParamsSchema =
  templatingWorkspaceKindParamsSchema.extend({
    entryId: z.string().min(1),
  });

export const templatingWorkspaceCommitBodySchema = z.object({
  message: z.string().min(1).max(500).optional(),
  changes: z
    .record(z.string(), z.union([z.string(), z.null()]))
    .refine((value) => Object.keys(value).length > 0, {
      message: "At least one path change is required",
    }),
});

export const templatingWorkspacePreviewBodySchema = z.object({
  props: z.record(z.string(), z.unknown()).optional(),
  subject: z.string().optional(),
});

export type TemplatingWorkspaceCommitBody = z.infer<
  typeof templatingWorkspaceCommitBodySchema
>;

export type TemplatingWorkspacePreviewBody = z.infer<
  typeof templatingWorkspacePreviewBodySchema
>;
