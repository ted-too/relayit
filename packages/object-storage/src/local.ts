import * as NodeFSP from "node:fs/promises";
import * as NodePath from "node:path";
import { Effect, Layer } from "effect";
import { type ObjectStorageService, ObjectStorage } from "./client";
import { ObjectStorageError } from "./errors";
import type { ObjectDownloadResult } from "./types";

const CONTENT_TYPE_SUFFIX = ".content-type";

/**
 * Object storage in a local directory, for development: each object is a file at its key,
 * its content type in a sibling file. Signed URLs need a real bucket and fail here.
 */
export const makeLocalObjectStorageLive = (directory: string) => {
  const root = NodePath.resolve(directory);
  const pathFor = (
    key: string,
    operation: ObjectStorageError["operation"],
  ): Effect.Effect<string, ObjectStorageError> => {
    const path = NodePath.resolve(root, key);
    return path.startsWith(`${root}${NodePath.sep}`)
      ? Effect.succeed(path)
      : Effect.fail(new ObjectStorageError({ cause: "key escapes the directory", key, operation }));
  };
  const attempt = <A>(
    key: string,
    operation: ObjectStorageError["operation"],
    run: (path: string) => Promise<A>,
  ) =>
    pathFor(key, operation).pipe(
      Effect.flatMap((path) =>
        Effect.tryPromise({
          catch: (cause) => new ObjectStorageError({ cause, key, operation }),
          try: () => run(path),
        }),
      ),
    );
  const unsupported = (key: string, operation: "signedDownloadUrl" | "signedUploadUrl") =>
    Effect.fail(
      new ObjectStorageError({
        cause: "Signed URLs need S3; OBJECT_STORAGE=local has none",
        key,
        operation,
      }),
    );

  return Layer.succeed(ObjectStorage, {
    delete: (key) =>
      attempt(key, "delete", (path) =>
        Promise.all([
          NodeFSP.rm(path, { force: true }),
          NodeFSP.rm(path + CONTENT_TYPE_SUFFIX, { force: true }),
        ]).then(() => undefined),
      ),
    download: (key) =>
      attempt(key, "download", async (path) => {
        const body = new Uint8Array(await NodeFSP.readFile(path));
        const contentType = await NodeFSP.readFile(path + CONTENT_TYPE_SUFFIX, "utf8").catch(
          () => undefined,
        );
        return { body, contentType } satisfies ObjectDownloadResult;
      }),
    exists: (key) =>
      attempt(key, "exists", (path) =>
        NodeFSP.stat(path).then(
          (stat) => stat.isFile(),
          () => false,
        ),
      ),
    signedDownloadUrl: (key) => unsupported(key, "signedDownloadUrl"),
    signedUploadUrl: (key) => unsupported(key, "signedUploadUrl"),
    upload: (key, body, options) =>
      attempt(key, "upload", async (path) => {
        await NodeFSP.mkdir(NodePath.dirname(path), { recursive: true });
        await NodeFSP.writeFile(path, body);
        if (options?.contentType) {
          await NodeFSP.writeFile(path + CONTENT_TYPE_SUFFIX, options.contentType);
        } else {
          await NodeFSP.rm(path + CONTENT_TYPE_SUFFIX, { force: true });
        }
        return { key };
      }),
  } satisfies ObjectStorageService);
};
