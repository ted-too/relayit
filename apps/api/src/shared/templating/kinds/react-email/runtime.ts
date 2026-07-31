import { buildRuntimeWorkspaceKindConfig } from "../../registry";
import { REACT_EMAIL_CLIENT_CONFIG } from "./client";
import { inferReactEmailPropsFromSource } from "./props";

export const REACT_EMAIL_RUNTIME_CONFIG = buildRuntimeWorkspaceKindConfig({
  clientConfig: REACT_EMAIL_CLIENT_CONFIG,
  inferPropsFromEntrySource: inferReactEmailPropsFromSource,
});
