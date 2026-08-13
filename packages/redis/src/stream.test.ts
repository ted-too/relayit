import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { decodeAutoClaimResult, decodeReadGroupEntries } from "./stream";

describe("Bun Redis stream responses", () => {
  test("fails malformed stream reads with a tagged response error", () =>
    Effect.runPromise(
      decodeReadGroupEntries({ "relayit:jobs": "invalid" }).pipe(
        Effect.flip,
        Effect.flatMap((error) =>
          Effect.sync(() => {
            expect(error).toMatchObject({
              _tag: "RedisResponseError",
              operation: "read-group",
            });
          })
        )
      )
    ));

  test("decodes auto-claimed entries and the next cursor", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* decodeAutoClaimResult([
          "3-0",
          [["2-0", ["payload", '{"deliveryId":"delivery_2"}']]],
          [],
        ]);
        expect(result).toEqual({
          entries: [
            {
              fields: ["payload", '{"deliveryId":"delivery_2"}'],
              id: "2-0",
            },
          ],
          nextStart: "3-0",
        });
      })
    ));

  test("decodes object-shaped reads", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* decodeReadGroupEntries({
          "relayit:jobs": [["1-0", ["payload", '{"deliveryId":"delivery_1"}']]],
        });
        expect(result).toEqual([
          {
            fields: ["payload", '{"deliveryId":"delivery_1"}'],
            id: "1-0",
            stream: "relayit:jobs",
          },
        ]);
      })
    ));

  test("decodes protocol-shaped reads", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const result = yield* decodeReadGroupEntries([
          [
            "relayit:jobs",
            [["2-0", ["payload", '{"deliveryId":"delivery_2"}']]],
          ],
        ]);
        expect(result).toEqual([
          {
            fields: ["payload", '{"deliveryId":"delivery_2"}'],
            id: "2-0",
            stream: "relayit:jobs",
          },
        ]);
      })
    ));
});
