import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Redacted } from "effect";
import { objectStorageConfig } from "./config";

const S3 = {
  S3_ACCESS_KEY_ID: "key",
  S3_BUCKET: "relayit",
  S3_ENDPOINT: "https://s3.example.com",
  S3_SECRET_ACCESS_KEY: "secret",
};

const resolve = (env: Record<string, string>) =>
  objectStorageConfig.pipe(
    Effect.provide(ConfigProvider.layer(ConfigProvider.fromEnvRecord(env))),
    Effect.result,
  );

describe("objectStorageConfig", () => {
  it.effect("keeps S3, with the same variables required, when nothing selects local", () =>
    Effect.gen(function* () {
      const result = yield* resolve({ ...S3, NODE_ENV: "production" });
      expect(result).toMatchObject({ success: { bucket: "relayit", kind: "s3", region: "auto" } });
      if (result._tag === "Success" && result.success.kind === "s3") {
        expect(Redacted.value(result.success.accessKeyId)).toBe("key");
      }
      expect(yield* resolve(S3)).toMatchObject({ success: { kind: "s3" } });
      expect(yield* resolve({})).toMatchObject({ _tag: "Failure" });
    }),
  );

  it.effect("uses local storage under development, test or OBJECT_STORAGE=local", () =>
    Effect.gen(function* () {
      expect(yield* resolve({ NODE_ENV: "development" })).toMatchObject({
        success: { kind: "local" },
      });
      expect(
        yield* resolve({ NODE_ENV: "test", OBJECT_STORAGE_DIR: "/tmp/objects" }),
      ).toMatchObject({
        success: { directory: "/tmp/objects", kind: "local" },
      });
      expect(yield* resolve({ OBJECT_STORAGE: "local" })).toMatchObject({
        success: { kind: "local" },
      });
      expect(
        yield* resolve({ ...S3, NODE_ENV: "development", OBJECT_STORAGE: "s3" }),
      ).toMatchObject({
        success: { kind: "s3" },
      });
    }),
  );

  it.effect("refuses local storage under NODE_ENV=production", () =>
    Effect.gen(function* () {
      expect(yield* resolve({ NODE_ENV: "production", OBJECT_STORAGE: "local" })).toMatchObject({
        failure: { _tag: "LocalObjectStorageInProduction" },
      });
    }),
  );
});
