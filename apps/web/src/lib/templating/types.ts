import type {
  PrimitiveTemplateVariables,
  TemplateEmailVariantContent,
} from "@repo/persistence/db/schema";

export interface TemplateListItem {
  readonly archivedAt: Date | null;
  readonly channelVariants: readonly {
    readonly broken: boolean;
    readonly channel: string;
    readonly content: TemplateEmailVariantContent | null;
    readonly createdAt: Date;
    readonly engine: string;
    readonly id: string;
    readonly updatedAt: Date;
    readonly variables: PrimitiveTemplateVariables | null;
    readonly workspaceEntryId: string | null;
  }[];
  readonly createdAt: Date;
  readonly id: string;
  readonly name: string;
  readonly organizationId: string;
  readonly slug: string;
  readonly updatedAt: Date;
}

export interface WorkspaceEntryListItem {
  readonly artifactCommitSha: string | null;
  readonly artifactStorageKey: string | null;
  readonly builtAt: Date | null;
  readonly createdAt: Date;
  readonly deletedAt: Date | null;
  readonly id: string;
  readonly path: string;
  readonly pickable: boolean;
  readonly updatedAt: Date;
}
