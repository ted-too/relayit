import { describe, expect, test } from "bun:test";
import { makeSchemaJsonCodec } from "@repo/redis";
import { Effect, Schema } from "effect";

const deliveryCodec = makeSchemaJsonCodec(
  Schema.Struct({
    deliveryId: Schema.String,
  })
);

describe("Redis codecs", () => {
  test("round trips schema-validated JSON values", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const encoded = yield* deliveryCodec.encode({
          deliveryId: "delivery_1",
        });
        const decoded = yield* deliveryCodec.decode(encoded);

        expect(encoded).toBe('{"deliveryId":"delivery_1"}');
        expect(decoded).toEqual({ deliveryId: "delivery_1" });
      })
    ));

  test("fails invalid values in the typed error channel", () =>
    Effect.runPromise(
      Effect.gen(function* () {
        const exit = yield* Effect.exit(
          deliveryCodec.decode('{"deliveryId":1}')
        );

        expect(exit._tag).toBe("Failure");
      })
    ));
});
