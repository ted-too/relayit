import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { Effect } from "effect";
import { TemplatingBuilderError } from "../rpc/errors";
import { readTreeAtCommit } from "./commit";
import { getBlob } from "./objects";
import { getRef } from "./refs";

/** Materialize a ref’s tree into `destDir` (created if missing). */
export const checkoutRefToDirectory = (input: {
  destDir: string;
  ref: string;
  workspaceId: string;
}) =>
  Effect.gen(function* () {
    const tip = yield* getRef(input.workspaceId, input.ref);
    if (!tip) {
      return yield* new TemplatingBuilderError({
        code: "not_found",
        message: "Unknown workspace ref.",
      });
    }

    const tree = yield* readTreeAtCommit(input.workspaceId, tip);

    yield* Effect.tryPromise({
      catch: () =>
        new TemplatingBuilderError({
          code: "failed",
          message: "Failed to create checkout directory.",
        }),
      try: () => NodeFSP.mkdir(input.destDir, { recursive: true }),
    });

    for (const [filePath, blobId] of Object.entries(tree)) {
      const blob = yield* getBlob(input.workspaceId, blobId);
      const abs = NodePath.join(input.destDir, filePath);
      yield* Effect.tryPromise({
        catch: () =>
          new TemplatingBuilderError({
            code: "failed",
            message: "Failed to write checkout file.",
          }),
        try: async () => {
          await NodeFSP.mkdir(NodePath.dirname(abs), { recursive: true });
          await NodeFSP.writeFile(abs, blob);
        },
      });
    }

    return { commitSha: tip };
  });
