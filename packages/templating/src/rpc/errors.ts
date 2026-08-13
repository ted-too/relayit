import { Schema } from "effect";

/** Rpc / builder failure visible to web callers. */
export class TemplatingBuilderError extends Schema.TaggedErrorClass<TemplatingBuilderError>()(
  "TemplatingBuilderError",
  {
    code: Schema.Literals([
      "unauthorized",
      "not_found",
      "invalid",
      "failed",
      "busy",
      "not_implemented",
    ]),
    /** Static human-readable summary — do not interpolate identifiers into this. */
    message: Schema.String,
  }
) {}

export class BuilderUnauthorized extends Schema.TaggedErrorClass<BuilderUnauthorized>()(
  "BuilderUnauthorized",
  {
    message: Schema.String,
  }
) {}
