import { Cause, Effect, Predicate } from "effect";

const EXPECTED_CLIENT_CODES = new Set([
  "bad_request",
  "busy",
  "claim_conflict",
  "conflict",
  "forbidden",
  "in_use",
  "invalid",
  "invalid_signature",
  "not_found",
  "unauthorized",
  "unavailable",
]);

const SKIP_ANNOTATION_KEYS = new Set([
  "_tag",
  "body",
  "cause",
  "credentials",
  "headers",
  "message",
  "name",
  "payload",
  "rawBody",
  "secret",
  "stack",
  "token",
]);

const isAnnotationScalar = (
  value: unknown
): value is string | number | boolean =>
  (typeof value === "string" && value.length > 0) ||
  typeof value === "number" ||
  typeof value === "boolean";

/**
 * Pulls identifiers off a tagged failure and any nested `.cause`. First-wins
 * so the outer `code` stays; inner `typeId` / `providerId` fill in. Secrets
 * and bulky payloads are skipped.
 */
export const failureAnnotations = (error: unknown): Record<string, unknown> => {
  const annotations: Record<string, unknown> = {};

  const visit = (value: unknown) => {
    if (!Predicate.isObject(value) || Predicate.isDate(value)) {
      return;
    }

    if (typeof value._tag === "string" && value._tag.length > 0) {
      if (annotations.errorTag === undefined) {
        annotations.errorTag = value._tag;
      } else if (annotations.causeTag === undefined) {
        annotations.causeTag = value._tag;
      }
    }

    if (typeof value.code === "string" && value.code.length > 0) {
      if (annotations.code === undefined) {
        annotations.code = value.code;
      } else if (
        annotations.causeCode === undefined &&
        value.code !== annotations.code
      ) {
        annotations.causeCode = value.code;
      }
    }

    if (
      annotations.errorMessage === undefined &&
      typeof value.message === "string" &&
      value.message.length > 0
    ) {
      annotations.errorMessage = value.message;
    }

    for (const [key, field] of Object.entries(value)) {
      if (SKIP_ANNOTATION_KEYS.has(key) || annotations[key] !== undefined) {
        continue;
      }
      if (isAnnotationScalar(field)) {
        annotations[key] = field;
      } else if (Predicate.isDate(field)) {
        annotations[key] = field.toISOString();
      }
    }

    if (Predicate.isObject(value.details)) {
      for (const [key, field] of Object.entries(value.details)) {
        if (annotations[key] !== undefined || !isAnnotationScalar(field)) {
          continue;
        }
        annotations[key] = field;
      }
    }

    visit(value.cause);
  };

  visit(error);
  return annotations;
};

export const logEffectFailure =
  (message: string) => (cause: Cause.Cause<unknown>) => {
    if (Cause.hasInterruptsOnly(cause)) {
      return Effect.void;
    }

    const error = Cause.squash(cause);
    const annotations = failureAnnotations(error);
    const code =
      typeof annotations.code === "string" ? annotations.code : undefined;
    const expected =
      !Cause.hasDies(cause) &&
      code !== undefined &&
      EXPECTED_CLIENT_CODES.has(code);
    const log = expected
      ? Effect.logDebug(message, cause)
      : Effect.logError(message, cause);

    return log.pipe(Effect.annotateLogs(annotations));
  };
