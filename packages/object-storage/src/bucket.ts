import { Effect } from "effect";
import type { z } from "zod";
import { ObjectStorage } from "./client";
import { ObjectKeyParamsError } from "./errors";
import type {
  ObjectKeySegment,
  ObjectSignedDownloadUrlOptions,
  ObjectSignedUploadUrlOptions,
  ObjectUploadOptions,
  SubBucketDefinition,
} from "./types";

const segmentToString = (segment: ObjectKeySegment): string =>
  typeof segment === "number" ? String(segment) : segment;

const objectKey = (
  prefix: readonly ObjectKeySegment[],
  segments: readonly ObjectKeySegment[]
): string => [...prefix, ...segments].map(segmentToString).join("/");

export const subBucket = <S extends z.ZodType>(
  definition: SubBucketDefinition<S>
) => {
  type KeyParams = z.infer<S>;
  const name = definition.name.map(segmentToString).join("/");

  const resolveKey = (params: KeyParams) =>
    Effect.try({
      catch: (cause) => new ObjectKeyParamsError({ cause, subBucket: name }),
      try: () => {
        const parsed = definition.schema.parse(params) as KeyParams;
        return objectKey(definition.name, definition.key(parsed));
      },
    });

  return {
    delete: (params: KeyParams) =>
      Effect.gen(function* () {
        const storage = yield* ObjectStorage;
        return yield* storage.delete(yield* resolveKey(params));
      }),
    download: (params: KeyParams) =>
      Effect.gen(function* () {
        const storage = yield* ObjectStorage;
        return yield* storage.download(yield* resolveKey(params));
      }),
    exists: (params: KeyParams) =>
      Effect.gen(function* () {
        const storage = yield* ObjectStorage;
        return yield* storage.exists(yield* resolveKey(params));
      }),
    key: resolveKey,
    name: definition.name,
    signedDownloadUrl: (
      params: KeyParams,
      options?: ObjectSignedDownloadUrlOptions
    ) =>
      Effect.gen(function* () {
        const storage = yield* ObjectStorage;
        return yield* storage.signedDownloadUrl(
          yield* resolveKey(params),
          options
        );
      }),
    signedUploadUrl: (
      params: KeyParams,
      options?: ObjectSignedUploadUrlOptions
    ) =>
      Effect.gen(function* () {
        const storage = yield* ObjectStorage;
        return yield* storage.signedUploadUrl(
          yield* resolveKey(params),
          options
        );
      }),
    upload: (
      params: KeyParams,
      body: Uint8Array,
      options?: ObjectUploadOptions
    ) =>
      Effect.gen(function* () {
        const storage = yield* ObjectStorage;
        return yield* storage.upload(yield* resolveKey(params), body, options);
      }),
  };
};
