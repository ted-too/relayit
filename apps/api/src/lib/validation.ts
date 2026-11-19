import { ByteSize, Effect, Layer, Result, Schema, SchemaIssue } from "effect";
import { HttpIncomingMessage, HttpRouter, HttpServerRequest } from "effect/http";
import {
  MAX_SEND_BODY_BYTES,
  PayloadTooLarge,
  RequestValidation,
  requestSchemas,
  SchemaValidationFailed,
} from "../api";
import { closeAfterAnswer } from "./body-limit";

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

const JSON_MEDIA_TYPE = /^application\/json\s*(?:;|$)/i;

const decodeLegacyParams = Schema.decodeUnknownResult(requestSchemas.sendRawEmail.params);
const decodeLegacyHeaders = Schema.decodeUnknownResult(requestSchemas.sendRawEmail.headers);

/** By endpoint: the endpoints that take a body, and how each request is checked. */
const decoders = new Map<
  string,
  {
    readonly headers: (input: unknown) => Result.Result<unknown, Schema.SchemaError>;
    readonly params?: (input: unknown) => Result.Result<unknown, Schema.SchemaError>;
    readonly payload: (input: unknown) => Result.Result<unknown, Schema.SchemaError>;
  }
>([
  [
    "sendEmail",
    {
      headers: Schema.decodeUnknownResult(requestSchemas.sendEmail.headers),
      payload: Schema.decodeUnknownResult(requestSchemas.sendEmail.payload),
    },
  ],
  [
    "sendRawEmail",
    {
      headers: decodeLegacyHeaders,
      params: decodeLegacyParams,
      payload: Schema.decodeUnknownResult(requestSchemas.sendRawEmail.payload),
    },
  ],
  [
    "sendTemplateEmail",
    {
      headers: decodeLegacyHeaders,
      params: decodeLegacyParams,
      payload: Schema.decodeUnknownResult(requestSchemas.sendTemplateEmail.payload),
    },
  ],
]);

/**
 * The failing property as a JSON pointer: where the failure is or, when a union's members
 * each fail somewhere different, the union itself.
 */
const toFailure = (on: "body" | "headers", error: Schema.SchemaError) => {
  const issues = formatIssues(error.issue).issues;
  const paths = issues.map((issue) => (issue.path ?? []).map(String));
  const first = paths[0] ?? [];
  const differs = first.findIndex((segment, index) =>
    paths.some((path) => path[index] !== segment),
  );
  const shared = differs === -1 ? first : first.slice(0, differs);
  const message = issues[0]?.message ?? "Invalid value";
  return new SchemaValidationFailed({
    message,
    on,
    property: shared.length === 0 ? "root" : `/${shared.join("/")}`,
    summary: message,
    type: "validation",
  });
};

/**
 * Verifies a send's API key with `verify` before any of its body is read, so a client
 * without a good key can't make the api hold a body. Only a body over
 * `MAX_SEND_BODY_BYTES` by its `Content-Length` comes first, a `413` that needs no read.
 * A request whose key fails is answered as it always was when nothing but its key was
 * wrong, and a path or header that fails its schema still comes before the key's own
 * failure: that is what answers `422` for a missing `x-api-key` on `/messages/email`.
 * What such a request no longer gets is an answer about its body.
 */
export const beforeBody = <A, E, R>(endpoint: string, verify: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    if (Number(request.headers["content-length"] ?? 0) > MAX_SEND_BODY_BYTES) {
      return yield* new PayloadTooLarge({
        code: "payload_too_large",
        message: "Request body exceeds the 50 MiB limit.",
      });
    }
    return yield* verify.pipe(
      Effect.catch((keyFailure) =>
        Effect.gen(function* () {
          const decode = decoders.get(endpoint);
          if (decode?.params !== undefined) {
            const params = decode.params(yield* HttpRouter.params);
            if (Result.isFailure(params)) {
              return yield* Effect.fail("NOT_FOUND" as const);
            }
          }
          const headers = decode?.headers(request.headers);
          if (headers !== undefined && Result.isFailure(headers)) {
            return yield* toFailure("headers", headers.failure);
          }
          return yield* Effect.fail(keyFailure);
        }),
      ),
    );
  });

/**
 * Checks a request against its endpoint's schemas once its key has passed `beforeBody`,
 * answering as the api always has: a body that isn't JSON is a bare `400 Bad Request`, a
 * header or body that fails its schema a `422`. A body sent without a JSON content type
 * was never parsed, so it fails as a missing object. The endpoint decodes them again
 * afterwards, and they pass. A body without a `Content-Length` is a `413` once reading it
 * passes `MAX_SEND_BODY_BYTES`.
 */
export const RequestValidationLive = Layer.succeed(
  RequestValidation,
  RequestValidation.of((httpEffect, { endpoint }) =>
    Effect.gen(function* () {
      const decode = decoders.get(endpoint.identifier);
      if (decode === undefined) {
        return yield* httpEffect;
      }
      const request = yield* HttpServerRequest.HttpServerRequest;
      // In order: the body is parsed, then the path, headers and body are checked.
      let body: unknown;
      if (JSON_MEDIA_TYPE.test(request.headers["content-type"] ?? "")) {
        const read = yield* Effect.result(request.text);
        if (Result.isFailure(read)) {
          const { reason } = read.failure;
          if (reason._tag === "RequestParseError" && reason.reason === "BodyTooLarge") {
            yield* closeAfterAnswer;
            return yield* new PayloadTooLarge({
              code: "payload_too_large",
              message: "Request body exceeds the 50 MiB limit.",
            });
          }
          return yield* Effect.die(read.failure);
        }
        const text = read.success;
        if (text !== "") {
          const parsed = Result.try(() => JSON.parse(text) as unknown);
          if (Result.isFailure(parsed)) {
            return yield* Effect.fail("Bad Request" as const);
          }
          body = parsed.success;
        }
      }
      if (decode.params !== undefined) {
        // The router matches an empty `:project`; no route took one before.
        const params = decode.params(yield* HttpRouter.params);
        if (Result.isFailure(params)) {
          return yield* Effect.fail("NOT_FOUND" as const);
        }
      }
      const headers = decode.headers(request.headers);
      if (Result.isFailure(headers)) {
        return yield* toFailure("headers", headers.failure);
      }
      const decoded = decode.payload(body);
      if (Result.isFailure(decoded)) {
        return yield* toFailure("body", decoded.failure);
      }
      return yield* httpEffect;
    }).pipe(
      // The endpoint reads the body again, from the same cache, under the same limit.
      Effect.provideService(
        HttpIncomingMessage.MaxBodySize,
        ByteSize.fromInputUnsafe(MAX_SEND_BODY_BYTES),
      ),
    ),
  ),
);
