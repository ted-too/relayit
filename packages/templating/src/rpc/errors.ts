import { Schema } from "effect";

/** Rpc / builder failure visible to web callers. */
export class TemplatingBuilderError extends Schema.TaggedError<TemplatingBuilderError>()(
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
    /** Why, in the failing tool's own words (a render error's message), for the log. */
    detail: Schema.optional(Schema.String),
  },
) {}

export class BuilderUnauthorized extends Schema.TaggedError<BuilderUnauthorized>()(
  "BuilderUnauthorized",
  {
    message: Schema.String,
  },
) {}
