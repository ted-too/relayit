import type {
  TemplateListItem,
  WorkspaceEntryListItem,
} from "@/lib/templating/types";

export type Template = TemplateListItem;

export type TemplateChannelVariant = Template["channelVariants"][number];

export type WorkspaceEntry = WorkspaceEntryListItem;
