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
    /**
     * Why the workspace's own source failed, in the failing tool's words: an install's
     * stderr, the bundler's messages, a render error. The api shows it to the Project's
     * members, so it carries nothing of the host.
     */
    detail: Schema.optional(Schema.String),
  },
) {}

export class BuilderUnauthorized extends Schema.TaggedError<BuilderUnauthorized>()(
  "BuilderUnauthorized",
  {
    message: Schema.String,
  },
) {}
