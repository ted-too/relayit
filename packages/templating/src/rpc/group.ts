import { Rpc, RpcGroup, RpcMiddleware } from "effect/unstable/rpc";
import { BuilderUnauthorized, TemplatingBuilderError } from "./errors";
import {
  BuilderCommitResult,
  BuilderDepsSyncResult,
  BuilderFileList,
  BuilderFileRead,
  BuilderPreviewResult,
  BuilderPublishResult,
  WorkspaceCommitPayload,
  WorkspaceFilePayload,
  WorkspaceIdPayload,
  WorkspacePreviewPayload,
  WorkspaceRefPayload,
} from "./schemas";

/** Shared-secret auth between web and template-builder. */
export class BuilderAuthMiddleware extends RpcMiddleware.Service<
  BuilderAuthMiddleware,
  {
    clientError: BuilderUnauthorized;
    provides: never;
    requires: never;
  }
>()("BuilderAuthMiddleware", {
  error: BuilderUnauthorized,
  requiredForClient: true,
}) {}

const builderError = TemplatingBuilderError;

/** Effect Rpc contract: sole Git-mutator surface for hosted Email Workspaces. */
export const TemplatingBuilderRpcs = RpcGroup.make(
  Rpc.make("listFiles", {
    error: builderError,
    payload: WorkspaceRefPayload,
    success: BuilderFileList,
  }),
  Rpc.make("readFile", {
    error: builderError,
    payload: WorkspaceFilePayload,
    success: BuilderFileRead,
  }),
  Rpc.make("commitFiles", {
    error: builderError,
    payload: WorkspaceCommitPayload,
    success: BuilderCommitResult,
  }),
  Rpc.make("depsSync", {
    error: builderError,
    payload: WorkspaceIdPayload,
    success: BuilderDepsSyncResult,
  }),
  Rpc.make("publish", {
    error: builderError,
    payload: WorkspaceIdPayload,
    success: BuilderPublishResult,
  }),
  Rpc.make("preview", {
    error: builderError,
    payload: WorkspacePreviewPayload,
    success: BuilderPreviewResult,
  })
).middleware(BuilderAuthMiddleware);
