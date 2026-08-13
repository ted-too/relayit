import { S3, S3Service } from "@effect-aws/client-s3";
import { Context, DateTime, Effect, Layer } from "effect";
import {
  ObjectBodyEmpty,
  ObjectSignedUrlExpiryError,
  ObjectStorageError,
} from "./errors";
import {
  DEFAULT_SIGNED_URL_EXPIRES_SECONDS,
  type ObjectDownloadResult,
  type ObjectSignedDownloadUrlOptions,
  type ObjectSignedDownloadUrlResult,
  type ObjectSignedUploadUrlOptions,
  type ObjectSignedUploadUrlResult,
  type ObjectStorageConfig,
  type ObjectUploadOptions,
  type ObjectUploadResult,
} from "./types";

const MINIMUM_SIGNED_URL_EXPIRY_SECONDS = 1;
const MAXIMUM_SIGNED_URL_EXPIRY_SECONDS = 604_800;

const hasTransformToByteArray = (
  body: unknown
): body is { transformToByteArray: () => Promise<Uint8Array> } =>
  typeof body === "object" &&
  body !== null &&
  "transformToByteArray" in body &&
  typeof (body as { transformToByteArray: unknown }).transformToByteArray ===
    "function";

const readObjectBody = (key: string, body: unknown) => {
  if (body === undefined || body === null) {
    return Effect.fail(new ObjectBodyEmpty({ key }));
  }
  if (body instanceof Uint8Array) {
    return Effect.succeed(body);
  }
  if (hasTransformToByteArray(body)) {
    return Effect.tryPromise({
      catch: (cause) =>
        new ObjectStorageError({ cause, key, operation: "download" }),
      try: () => body.transformToByteArray(),
    });
  }
  return Effect.fail(new ObjectBodyEmpty({ key }));
};

export interface ObjectStorageService {
  readonly delete: (key: string) => Effect.Effect<void, ObjectStorageError>;
  readonly download: (
    key: string
  ) => Effect.Effect<
    ObjectDownloadResult,
    ObjectBodyEmpty | ObjectStorageError
  >;
  readonly exists: (key: string) => Effect.Effect<boolean, ObjectStorageError>;
  readonly signedDownloadUrl: (
    key: string,
    options?: ObjectSignedDownloadUrlOptions
  ) => Effect.Effect<
    ObjectSignedDownloadUrlResult,
    ObjectSignedUrlExpiryError | ObjectStorageError
  >;
  readonly signedUploadUrl: (
    key: string,
    options?: ObjectSignedUploadUrlOptions
  ) => Effect.Effect<
    ObjectSignedUploadUrlResult,
    ObjectSignedUrlExpiryError | ObjectStorageError
  >;
  readonly upload: (
    key: string,
    body: Uint8Array,
    options?: ObjectUploadOptions
  ) => Effect.Effect<ObjectUploadResult, ObjectStorageError>;
}

export class ObjectStorage extends Context.Service<
  ObjectStorage,
  ObjectStorageService
>()("ObjectStorage") {}

export const makeObjectStorageLive = (config: ObjectStorageConfig) => {
  const s3Live = S3.layer({
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    endpoint: config.endpoint.toString(),
    forcePathStyle: true,
    region: config.region,
    // Optional AWS SDK checksums are not portable across S3-compatible vendors.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
  });

  return Layer.effect(
    ObjectStorage,
    Effect.gen(function* () {
      const s3 = yield* S3Service;

      const expiresAt = (expiresInSeconds: number) =>
        DateTime.now.pipe(
          Effect.map((now) =>
            DateTime.addDuration(now, `${expiresInSeconds} seconds`)
          )
        );
      const signedUrlExpiry = (
        operation: "signedDownloadUrl" | "signedUploadUrl",
        expiresInSeconds: number | undefined
      ) => {
        const value = expiresInSeconds ?? DEFAULT_SIGNED_URL_EXPIRES_SECONDS;
        return Number.isInteger(value) &&
          value >= MINIMUM_SIGNED_URL_EXPIRY_SECONDS &&
          value <= MAXIMUM_SIGNED_URL_EXPIRY_SECONDS
          ? Effect.succeed(value)
          : Effect.fail(
              new ObjectSignedUrlExpiryError({
                expiresInSeconds: value,
                maximumSeconds: MAXIMUM_SIGNED_URL_EXPIRY_SECONDS,
                minimumSeconds: MINIMUM_SIGNED_URL_EXPIRY_SECONDS,
                operation,
              })
            );
      };

      return {
        delete: (key) =>
          s3.deleteObject({ Bucket: config.bucket, Key: key }).pipe(
            Effect.asVoid,
            Effect.mapError(
              (cause) =>
                new ObjectStorageError({ cause, key, operation: "delete" })
            )
          ),
        download: (key) =>
          Effect.gen(function* () {
            const response = yield* s3
              .getObject({ Bucket: config.bucket, Key: key })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new ObjectStorageError({
                      cause,
                      key,
                      operation: "download",
                    })
                )
              );
            const body = yield* readObjectBody(key, response.Body);
            return {
              body,
              contentType: response.ContentType,
            } satisfies ObjectDownloadResult;
          }),
        exists: (key) =>
          s3.headObject({ Bucket: config.bucket, Key: key }).pipe(
            Effect.as(true),
            Effect.catchTag("NotFound", () => Effect.succeed(false)),
            Effect.mapError(
              (cause) =>
                new ObjectStorageError({ cause, key, operation: "exists" })
            )
          ),
        signedDownloadUrl: (key, options) =>
          Effect.gen(function* () {
            const expiresIn = yield* signedUrlExpiry(
              "signedDownloadUrl",
              options?.expiresInSeconds
            );
            const url = yield* s3
              .getObject(
                { Bucket: config.bucket, Key: key },
                { expiresIn, presigned: true }
              )
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new ObjectStorageError({
                      cause,
                      key,
                      operation: "signedDownloadUrl",
                    })
                )
              );
            return {
              expiresAt: yield* expiresAt(expiresIn),
              url,
            } satisfies ObjectSignedDownloadUrlResult;
          }),
        signedUploadUrl: (key, options) =>
          Effect.gen(function* () {
            const expiresIn = yield* signedUrlExpiry(
              "signedUploadUrl",
              options?.expiresInSeconds
            );
            const url = yield* s3
              .putObject(
                {
                  Bucket: config.bucket,
                  ContentType: options?.contentType,
                  Key: key,
                },
                { expiresIn, presigned: true }
              )
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new ObjectStorageError({
                      cause,
                      key,
                      operation: "signedUploadUrl",
                    })
                )
              );
            return {
              expiresAt: yield* expiresAt(expiresIn),
              key,
              url,
            } satisfies ObjectSignedUploadUrlResult;
          }),
        upload: (key, body, options) =>
          s3
            .putObject({
              Body: body,
              Bucket: config.bucket,
              ContentType: options?.contentType,
              Key: key,
            })
            .pipe(
              Effect.as({ key } satisfies ObjectUploadResult),
              Effect.mapError(
                (cause) =>
                  new ObjectStorageError({ cause, key, operation: "upload" })
              )
            ),
      } satisfies ObjectStorageService;
    })
  ).pipe(Layer.provide(s3Live));
};
