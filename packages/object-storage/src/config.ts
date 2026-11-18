import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { Config, Data, Effect, Option, Redacted } from "effect";
import { makeObjectStorageLive } from "./client";
import { makeLocalObjectStorageLive } from "./local";

export class LocalObjectStorageOutsideDevelopment extends Data.TaggedError(
  "LocalObjectStorageOutsideDevelopment",
)<{
  readonly message: string;
}> {}

/** The checkout's gitignored `temp/`, shared by every app run from it. */
const DEFAULT_LOCAL_DIRECTORY = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../../temp/object-storage",
);

/**
 * Local only when NODE_ENV says development or test, whether `OBJECT_STORAGE` asks for it or
 * is unset; otherwise S3. The images don't set NODE_ENV, so a deployment never keeps objects on
 * one container's disk, and an unset `OBJECT_STORAGE` there needs the `S3_*` variables.
 */
export const objectStorageConfig = Effect.gen(function* () {
  const configured = Option.getOrUndefined(
    yield* Config.Literals(["local", "s3"], "OBJECT_STORAGE").pipe(Config.option),
  );
  const nodeEnv = Option.getOrUndefined(yield* Config.String("NODE_ENV").pipe(Config.option));
  const development = nodeEnv === "development" || nodeEnv === "test";
  if (configured === "local" && !development) {
    return yield* new LocalObjectStorageOutsideDevelopment({
      message: "OBJECT_STORAGE=local runs only with NODE_ENV=development or test; use a bucket.",
    });
  }
  if ((configured ?? (development ? "local" : "s3")) === "local") {
    return {
      directory: yield* Config.String("OBJECT_STORAGE_DIR").pipe(
        Config.withDefault(DEFAULT_LOCAL_DIRECTORY),
      ),
      kind: "local" as const,
    };
  }
  return {
    kind: "s3" as const,
    ...(yield* Config.all({
      accessKeyId: Config.Redacted("S3_ACCESS_KEY_ID"),
      bucket: Config.String("S3_BUCKET"),
      endpoint: Config.URL("S3_ENDPOINT"),
      region: Config.String("S3_REGION").pipe(Config.withDefault("auto")),
      secretAccessKey: Config.Redacted("S3_SECRET_ACCESS_KEY"),
    })),
  };
});

export const makeObjectStorageLayer = (config: Effect.Success<typeof objectStorageConfig>) =>
  config.kind === "local"
    ? makeLocalObjectStorageLive(config.directory)
    : makeObjectStorageLive({
        accessKeyId: Redacted.value(config.accessKeyId),
        bucket: config.bucket,
        endpoint: config.endpoint,
        region: config.region,
        secretAccessKey: Redacted.value(config.secretAccessKey),
      });
