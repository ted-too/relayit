import { Data, Effect, Schema } from "effect";

export class RedisCodecError extends Data.TaggedError("RedisCodecError")<{
  readonly cause: unknown;
  readonly operation: "decode" | "encode";
}> {}

export interface RedisCodec<Value, Requirements = never> {
  readonly decode: (
    value: string
  ) => Effect.Effect<Value, RedisCodecError, Requirements>;
  readonly encode: (
    value: Value
  ) => Effect.Effect<string, RedisCodecError, Requirements>;
}

const unknownFromJsonString = Schema.fromJsonString(Schema.Unknown);

export const makeSchemaJsonCodec = <ValueSchema extends Schema.Top>(
  schema: ValueSchema
): RedisCodec<
  ValueSchema["Type"],
  ValueSchema["DecodingServices"] | ValueSchema["EncodingServices"]
> => ({
  decode: (value) =>
    Schema.decodeEffect(unknownFromJsonString)(value).pipe(
      Effect.flatMap(Schema.decodeEffect(schema)),
      Effect.mapError(
        (cause) => new RedisCodecError({ cause, operation: "decode" })
      )
    ),
  encode: (value) =>
    Schema.encodeEffect(schema)(value).pipe(
      Effect.flatMap(Schema.encodeEffect(unknownFromJsonString)),
      Effect.mapError(
        (cause) => new RedisCodecError({ cause, operation: "encode" })
      )
    ),
});
