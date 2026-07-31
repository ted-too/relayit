import type { ApiClient, InferData } from "@/integrations/api";

type TemplatesGet = ReturnType<
  ReturnType<ApiClient["projects"]>["templating"]["templates"]["get"]
>;

export type Template = InferData<TemplatesGet>[number];

export type TemplateChannelVariant = Template["channelVariants"][number];

type EntriesGet = ReturnType<
  ReturnType<
    ReturnType<ApiClient["projects"]>["templating"]["workspace"]
  >["entries"]["get"]
>;

export type WorkspaceEntry = InferData<EntriesGet>[number];
