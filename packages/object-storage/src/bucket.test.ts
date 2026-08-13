import { describe, expect, test } from "bun:test";
import { Cause, Effect, Layer } from "effect";
import { z } from "zod";
import { subBucket } from "./bucket";
import { ObjectStorage, type ObjectStorageService } from "./client";

const objects = subBucket({
  key: ({ objectId, revision }) => [objectId, revision],
  name: ["messages", "attachments"],
  schema: z.object({
    objectId: z.string().min(1),
    revision: z.number().int().nonnegative(),
  }),
});

describe("subBucket", () => {
  test("validates and resolves namespaced keys", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const key = yield* objects.key({ objectId: "obj_123", revision: 2 });
        expect(key).toBe("messages/attachments/obj_123/2");
      })
    ));

  test("rejects invalid key parameters", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          objects.key({ objectId: "", revision: -1 })
        );
        expect(exit._tag).toBe("Failure");
        if (exit._tag === "Failure") {
          const reason = exit.cause.reasons[0];
          expect(reason && Cause.isFailReason(reason)).toBe(true);
          if (reason && Cause.isFailReason(reason)) {
            expect(reason.error).toMatchObject({
              _tag: "ObjectKeyParamsError",
              subBucket: "messages/attachments",
            });
          }
        }
      })
    ));

  test("delegates operations to the object-storage service", () => {
    const uploads: string[] = [];
    const unsupported = () => Effect.die("unsupported");
    const service = {
      delete: unsupported,
      download: unsupported,
      exists: () => Effect.succeed(false),
      signedDownloadUrl: unsupported,
      signedUploadUrl: unsupported,
      upload: (key) =>
        Effect.sync(() => {
          uploads.push(key);
          return { key };
        }),
    } satisfies ObjectStorageService;

    return Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* objects.upload(
          { objectId: "obj_123", revision: 2 },
          new Uint8Array([1, 2, 3])
        );
        expect(result).toEqual({ key: "messages/attachments/obj_123/2" });
        expect(uploads).toEqual(["messages/attachments/obj_123/2"]);
      }).pipe(Effect.provide(Layer.succeed(ObjectStorage, service)))
    );
  });
});
