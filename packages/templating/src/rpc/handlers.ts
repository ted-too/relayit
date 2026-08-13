import { Effect } from "effect";
import * as workspaceOps from "../ops/workspace";
import { TemplatingBuilderError } from "./errors";
import { TemplatingBuilderRpcs } from "./group";

const toBuilderError = (error: unknown) => {
  if (
    error !== null &&
    typeof error === "object" &&
    "_tag" in error &&
    (error as { _tag: unknown })._tag === "TemplatingBuilderError"
  ) {
    return error as TemplatingBuilderError;
  }
  return new TemplatingBuilderError({
    code: "failed",
    message: "Template builder operation failed.",
  });
};

const asRpc = <A, R>(effect: Effect.Effect<A, unknown, R>) =>
  effect.pipe(Effect.mapError(toBuilderError));

/** Rpc handlers for `apps/template-builder` — thin adapters over workspace ops. */
export const TemplatingBuilderHandlersLive = TemplatingBuilderRpcs.toLayer({
  commitFiles: (payload) => asRpc(workspaceOps.commitFiles(payload)),
  depsSync: (payload) => asRpc(workspaceOps.depsSync(payload)),
  listFiles: (payload) => asRpc(workspaceOps.listFiles(payload)),
  preview: (payload) => asRpc(workspaceOps.preview(payload)),
  publish: (payload) => asRpc(workspaceOps.publish(payload)),
  readFile: (payload) => asRpc(workspaceOps.readFile(payload)),
});
