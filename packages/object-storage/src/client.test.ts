import { describe, expect, test } from "bun:test";
import { Cause, Effect } from "effect";
import { makeObjectStorageLive, ObjectStorage } from "./client";

interface RecordedRequest {
  readonly headers: Record<string, string>;
  readonly method: string;
  readonly path: string;
}

const withTestServer = <Success, Error>(
  run: (context: {
    readonly endpoint: string;
    readonly requests: RecordedRequest[];
  }) => Effect.Effect<Success, Error>
) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const requests: RecordedRequest[] = [];
      const server = Bun.serve({
        fetch: (request) => {
          const path = new URL(request.url).pathname;
          requests.push({
            headers: Object.fromEntries(request.headers),
            method: request.method,
            path,
          });
          if (path.endsWith("/missing")) {
            return new Response(null, { status: 404 });
          }
          if (path.endsWith("/denied")) {
            return new Response(null, { status: 403 });
          }
          if (path.endsWith("/download")) {
            return new Response(new Uint8Array([1, 2, 3]), {
              headers: { "content-type": "application/octet-stream" },
            });
          }
          if (path.endsWith("/empty")) {
            return new Response(new Uint8Array());
          }
          return new Response(null);
        },
        port: 0,
      });
      return { requests, server };
    }),
    ({ requests, server }) =>
      run({
        endpoint: `http://${server.hostname}:${server.port}`,
        requests,
      }),
    ({ server }) => Effect.promise(() => server.stop(true))
  );

const makeTestLive = (endpoint: string) =>
  makeObjectStorageLive({
    accessKeyId: "test-access-key",
    bucket: "test-bucket",
    endpoint: new URL(endpoint),
    region: "de",
    secretAccessKey: "test-secret-key",
  });

describe("ObjectStorage.exists", () => {
  test("returns false when S3 reports that the object is missing", () =>
    Effect.runPromise(
      withTestServer(({ endpoint }) =>
        Effect.gen(function* () {
          const storage = yield* ObjectStorage;
          expect(yield* storage.exists("missing")).toBe(false);
        }).pipe(Effect.provide(makeTestLive(endpoint)))
      )
    ));

  test("preserves non-missing S3 failures", () =>
    Effect.runPromise(
      withTestServer(({ endpoint }) =>
        Effect.gen(function* () {
          const storage = yield* ObjectStorage;
          const exit = yield* Effect.exit(storage.exists("denied"));

          expect(exit._tag).toBe("Failure");
          if (exit._tag === "Failure") {
            const reason = exit.cause.reasons[0];
            expect(reason && Cause.isFailReason(reason)).toBe(true);
            if (reason && Cause.isFailReason(reason)) {
              expect(reason.error).toMatchObject({
                _tag: "ObjectStorageError",
                key: "denied",
                operation: "exists",
              });
            }
          }
        }).pipe(Effect.provide(makeTestLive(endpoint)))
      )
    ));
});

describe("ObjectStorage live operations", () => {
  test("uploads bytes without optional vendor-specific checksums", () =>
    Effect.runPromise(
      withTestServer(({ endpoint, requests }) =>
        Effect.gen(function* () {
          const storage = yield* ObjectStorage;
          expect(
            yield* storage.upload("upload", new Uint8Array([1, 2, 3]), {
              contentType: "application/octet-stream",
            })
          ).toEqual({ key: "upload" });

          const upload = requests.find((request) => request.method === "PUT");
          expect(upload?.path).toBe("/test-bucket/upload");
          expect(upload?.headers["x-amz-checksum-crc32"]).toBeUndefined();
        }).pipe(Effect.provide(makeTestLive(endpoint)))
      )
    ));

  test("downloads bytes and content type", () =>
    Effect.runPromise(
      withTestServer(({ endpoint }) =>
        Effect.gen(function* () {
          const storage = yield* ObjectStorage;
          const result = yield* storage.download("download");

          expect(Array.from(result.body)).toEqual([1, 2, 3]);
          expect(result.contentType).toBe("application/octet-stream");
        }).pipe(Effect.provide(makeTestLive(endpoint)))
      )
    ));

  test("downloads zero-byte objects", () =>
    Effect.runPromise(
      withTestServer(({ endpoint }) =>
        Effect.gen(function* () {
          const storage = yield* ObjectStorage;
          const result = yield* storage.download("empty");

          expect(result.body.byteLength).toBe(0);
        }).pipe(Effect.provide(makeTestLive(endpoint)))
      )
    ));

  test("deletes objects", () =>
    Effect.runPromise(
      withTestServer(({ endpoint, requests }) =>
        Effect.gen(function* () {
          const storage = yield* ObjectStorage;
          yield* storage.delete("delete");

          expect(
            requests.some(
              (request) =>
                request.method === "DELETE" &&
                request.path === "/test-bucket/delete"
            )
          ).toBe(true);
        }).pipe(Effect.provide(makeTestLive(endpoint)))
      )
    ));

  test("creates namespaced presigned URLs", () =>
    Effect.runPromise(
      withTestServer(({ endpoint }) =>
        Effect.gen(function* () {
          const storage = yield* ObjectStorage;
          const upload = yield* storage.signedUploadUrl("signed-upload", {
            contentType: "application/octet-stream",
            expiresInSeconds: 60,
          });
          const download = yield* storage.signedDownloadUrl("signed-download", {
            expiresInSeconds: 120,
          });
          const uploadUrl = new URL(upload.url);
          const downloadUrl = new URL(download.url);

          expect(upload.key).toBe("signed-upload");
          expect(uploadUrl.pathname).toBe("/test-bucket/signed-upload");
          expect(uploadUrl.searchParams.get("X-Amz-Expires")).toBe("60");
          expect(uploadUrl.searchParams.get("X-Amz-Credential")).toContain(
            "/de/s3/aws4_request"
          );
          expect(downloadUrl.pathname).toBe("/test-bucket/signed-download");
          expect(downloadUrl.searchParams.get("X-Amz-Expires")).toBe("120");
        }).pipe(Effect.provide(makeTestLive(endpoint)))
      )
    ));

  test("rejects presigned URL expiries outside SigV4 limits", () =>
    Effect.runPromise(
      withTestServer(({ endpoint }) =>
        Effect.gen(function* () {
          const storage = yield* ObjectStorage;
          const tooShort = yield* Effect.exit(
            storage.signedUploadUrl("signed-upload", { expiresInSeconds: 0 })
          );
          const tooLong = yield* Effect.exit(
            storage.signedDownloadUrl("signed-download", {
              expiresInSeconds: 604_801,
            })
          );

          expect(tooShort._tag).toBe("Failure");
          expect(tooLong._tag).toBe("Failure");
        }).pipe(Effect.provide(makeTestLive(endpoint)))
      )
    ));
});
