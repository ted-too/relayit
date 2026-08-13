import type { TemplateListItem } from "@/lib/templating/catalog";
import type { WorkspaceEntryListItem } from "@/lib/templating/workspace";

export type Template = TemplateListItem;

export type TemplateChannelVariant = Template["channelVariants"][number];

export type WorkspaceEntry = WorkspaceEntryListItem;
