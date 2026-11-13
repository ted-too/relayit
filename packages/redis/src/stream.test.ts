import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { decodeAutoClaimResult, decodeReadGroupEntries } from "./stream";

describe("Bun Redis stream responses", () => {
  it.effect("fails malformed stream reads with a tagged response error", () =>
    decodeReadGroupEntries({ "relayit:jobs": "invalid" }).pipe(
      Effect.flip,
      Effect.flatMap((error) =>
        Effect.sync(() => {
          expect(error).toMatchObject({
            _tag: "RedisResponseError",
            operation: "read-group",
          });
        }),
      ),
    ),
  );

  it.effect("decodes auto-claimed entries and the next cursor", () =>
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
    }),
  );

  it.effect("decodes object-shaped reads", () =>
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
    }),
  );

  it.effect("decodes protocol-shaped reads", () =>
    Effect.gen(function* () {
      const result = yield* decodeReadGroupEntries([
        ["relayit:jobs", [["2-0", ["payload", '{"deliveryId":"delivery_2"}']]]],
      ]);
      expect(result).toEqual([
        {
          fields: ["payload", '{"deliveryId":"delivery_2"}'],
          id: "2-0",
          stream: "relayit:jobs",
        },
      ]);
    }),
  );
});
