import { afterAll, describe, expect, it } from "@effect/vitest";
import * as NodeFSP from "node:fs/promises";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { Effect } from "effect";
import { ObjectStorage } from "./client";
import { makeLocalObjectStorageLive } from "./local";

const directory = await NodeFSP.mkdtemp(NodePath.join(NodeOS.tmpdir(), "relayit-object-storage-"));
afterAll(() => NodeFSP.rm(directory, { force: true, recursive: true }));

const withStorage = <A, E>(effect: Effect.Effect<A, E, ObjectStorage>) =>
  effect.pipe(Effect.provide(makeLocalObjectStorageLive(directory)));

describe("local object storage", () => {
  it.live("keeps an object and its content type under its key until deleted", () =>
    withStorage(
      Effect.gen(function* () {
        const storage = yield* ObjectStorage;
        const key = "templating/artifacts/ws_1/entry.js";
        yield* storage.upload(key, new Uint8Array([1, 2, 3]), { contentType: "text/javascript" });

        expect(yield* storage.exists(key)).toBe(true);
        expect(yield* storage.download(key)).toEqual({
          body: new Uint8Array([1, 2, 3]),
          contentType: "text/javascript",
        });
        const files = yield* Effect.promise(() =>
          NodeFSP.readdir(NodePath.join(directory, "templating/artifacts/ws_1")),
        );
        expect(files).toContain("entry.js");

        yield* storage.delete(key);
        expect(yield* storage.exists(key)).toBe(false);
      }),
    ),
  );

  it.live("fails a download of a missing key as S3 does, with ObjectStorageError", () =>
    withStorage(
      Effect.gen(function* () {
        const storage = yield* ObjectStorage;
        const error = yield* storage.download("missing").pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "ObjectStorageError", operation: "download" });
      }),
    ),
  );

  it.live("refuses a key that would leave its directory", () =>
    withStorage(
      Effect.gen(function* () {
        const storage = yield* ObjectStorage;
        const error = yield* storage.upload("../outside", new Uint8Array([1])).pipe(Effect.flip);
        expect(error).toMatchObject({ _tag: "ObjectStorageError", operation: "upload" });
        expect(
          yield* Effect.promise(() => NodeFSP.readdir(NodePath.dirname(directory))),
        ).not.toContain("outside");
      }),
    ),
  );
});
