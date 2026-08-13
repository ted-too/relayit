export { syncWorkspaceEntriesFromPaths } from "./entries";
export {
  HOSTED_DEV_REF,
  HOSTED_MAIN_REF,
  scaffoldHostedWorkspace,
} from "./git";
export * as WorkspaceOps from "./ops/workspace";
export {
  makeBuilderAuthClientLayer,
  makeBuilderAuthServerLayer,
} from "./rpc/auth";
export {
  makeTemplatingBuilderClientLive,
  makeTemplatingBuilderProtocolLive,
  TemplatingBuilderClient,
  type TemplatingBuilderRpcClient,
  withTemplatingBuilderClient,
} from "./rpc/client";
export { BuilderUnauthorized, TemplatingBuilderError } from "./rpc/errors";
export { BuilderAuthMiddleware, TemplatingBuilderRpcs } from "./rpc/group";
export { TemplatingBuilderHandlersLive } from "./rpc/handlers";
