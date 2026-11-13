import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import { Config, Data, Effect, Option, Redacted } from "effect";
import { makeObjectStorageLive } from "./client";
import { makeLocalObjectStorageLive } from "./local";

export class LocalObjectStorageInProduction extends Data.TaggedError(
  "LocalObjectStorageInProduction",
)<{
  readonly message: string;
}> {}

/** The checkout's gitignored `temp/`, shared by every app run from it. */
const DEFAULT_LOCAL_DIRECTORY = NodePath.resolve(
  NodePath.dirname(NodeURL.fileURLToPath(import.meta.url)),
  "../../../temp/object-storage",
);

/**
 * `OBJECT_STORAGE` when set. Otherwise local only when NODE_ENV says development or test:
 * the api, worker and builder images don't set NODE_ENV, so an unset one must keep meaning S3,
 * with the same required `S3_*` variables as before local mode existed.
 */
export const objectStorageConfig = Effect.gen(function* () {
  const configured = Option.getOrUndefined(
    yield* Config.literals(["local", "s3"], "OBJECT_STORAGE").pipe(Config.option),
  );
  const nodeEnv = Option.getOrUndefined(yield* Config.string("NODE_ENV").pipe(Config.option));
  if (configured === "local" && nodeEnv === "production") {
    return yield* new LocalObjectStorageInProduction({
      message: "OBJECT_STORAGE=local cannot run with NODE_ENV=production; use a bucket.",
    });
  }
  const local =
    configured === "local" ||
    (configured === undefined && (nodeEnv === "development" || nodeEnv === "test"));
  if (local) {
    return {
      directory: yield* Config.string("OBJECT_STORAGE_DIR").pipe(
        Config.withDefault(DEFAULT_LOCAL_DIRECTORY),
      ),
      kind: "local" as const,
    };
  }
  return {
    kind: "s3" as const,
    ...(yield* Config.all({
      accessKeyId: Config.redacted("S3_ACCESS_KEY_ID"),
      bucket: Config.string("S3_BUCKET"),
      endpoint: Config.url("S3_ENDPOINT"),
      region: Config.string("S3_REGION").pipe(Config.withDefault("auto")),
      secretAccessKey: Config.redacted("S3_SECRET_ACCESS_KEY"),
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
