/**
 * The api's HTTP surface as an `HttpApi`: routes, request schemas, every response a route
 * answers with, and the middleware in front of them. The OpenAPI document `/docs` serves is
 * generated from it. `/messages/email` and the legacy `/send/*` are customer contracts, so
 * the response bodies, statuses and content types here are the ones those routes have
 * always answered with (`contract.test.ts`); change them only on purpose.
 */
import { SES_NOTIFICATIONS_PATH } from "@repo/provider-aws/email/webhooks";
import { Context, Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
  OpenApi,
} from "effect/http-api";
import {
  LegacySendHeaders,
  LegacySendParams,
  LegacySendRawBody,
  LegacySendTemplateBody,
} from "./routes/compat/send/validators";
import { SendEmailBody, SendEmailHeaders } from "./routes/messages/validators/email";

// The content types the api has always answered with: Bun's for a JSON or text body,
// except a schema failure, which was plain `application/json`.
const json = HttpApiSchema.asJson({ contentType: "application/json;charset=utf-8" });
const text = HttpApiSchema.asText({ contentType: "text/plain;charset=utf-8" });

/**
 * The headers and JSON body each endpoint that takes a body declares. `RequestValidation`
 * checks a request against them before the endpoint's auth runs.
 */
export const requestSchemas = {
  sendEmail: { headers: SendEmailHeaders, payload: SendEmailBody },
  sendRawEmail: {
    headers: LegacySendHeaders,
    params: LegacySendParams,
    payload: LegacySendRawBody,
  },
  sendTemplateEmail: {
    headers: LegacySendHeaders,
    params: LegacySendParams,
    payload: LegacySendTemplateBody,
  },
};

/** A path no route takes: answered with the bare text, as an unrouted request is. */
export const RouteNotFound = Schema.Literal("NOT_FOUND").pipe(HttpApiSchema.status(404), text);

/** A body that is not JSON: answered with the bare status text. */
export const MalformedBody = Schema.Literal("Bad Request").pipe(HttpApiSchema.status(400), text);

/** A request that fails a schema: the failing property and what was wrong with it. */
export class SchemaValidationFailed extends Schema.Error<SchemaValidationFailed>(
  "SchemaValidationFailed",
)(
  {
    type: Schema.Literal("validation"),
    on: Schema.Literals(["body", "headers"]),
    property: Schema.String,
    message: Schema.String,
    summary: Schema.String,
  },
  { httpApiStatus: 422 },
) {}

/** A body the schema accepts but a send can't use, with a message saying which rule it broke. */
export class SendRefused extends Schema.Error<SendRefused>("SendRefused")(
  {
    message: Schema.String,
    on: Schema.Literal("body"),
    type: Schema.Literal("validation"),
  },
  { httpApiStatus: 422 },
) {}

export class InvalidApiKey extends Schema.Error<InvalidApiKey>("InvalidApiKey")(
  { code: Schema.Literal("invalid_api_key"), message: Schema.Literal("Invalid API key") },
  { httpApiStatus: 403 },
) {}

export class InvalidAppEnvironment extends Schema.Error<InvalidAppEnvironment>(
  "InvalidAppEnvironment",
)(
  {
    code: Schema.Literal("invalid_app_environment"),
    message: Schema.Literal("App and Environment headers must both be present, or both omitted."),
  },
  { httpApiStatus: 400 },
) {}

/** accept's refusal: its code, message and, for some codes, details. */
export class AcceptRefused extends Schema.Error<AcceptRefused>("AcceptRefused")(
  {
    code: Schema.String,
    message: Schema.String,
    details: Schema.optionalKey(
      Schema.Struct({
        detail: Schema.optionalKey(Schema.String),
        filename: Schema.optionalKey(Schema.String),
        max_bytes: Schema.optionalKey(Schema.Finite),
        reason: Schema.optionalKey(Schema.String),
        status: Schema.optionalKey(Schema.Finite),
        variable: Schema.optionalKey(Schema.String),
      }),
    ),
  },
  { httpApiStatus: 422 },
) {}

export class SendLimitExceeded extends Schema.Error<SendLimitExceeded>("SendLimitExceeded")(
  {
    code: Schema.Literals(["daily_limit_exceeded", "monthly_limit_exceeded"]),
    message: Schema.String,
    retry_after_seconds: Schema.Finite,
  },
  { httpApiStatus: 429 },
) {}

export class InternalServerError extends Schema.Error<InternalServerError>("InternalServerError")(
  { code: Schema.Literal("internal_server_error"), message: Schema.String },
  { httpApiStatus: 500 },
) {}

/** The legacy endpoints' error shape: a message and, for refusals, the codes. */
const legacyFields = { details: Schema.Array(Schema.String), message: Schema.String };

export class LegacyUnauthorized extends Schema.Error<LegacyUnauthorized>("LegacyUnauthorized")(
  legacyFields,
  { httpApiStatus: 401 },
) {}

export class LegacyProjectNotFound extends Schema.Error<LegacyProjectNotFound>(
  "LegacyProjectNotFound",
)(legacyFields, { httpApiStatus: 404 }) {}

export class LegacyRefused extends Schema.Error<LegacyRefused>("LegacyRefused")(legacyFields, {
  httpApiStatus: 400,
}) {}

export class LegacyLimitExceeded extends Schema.Error<LegacyLimitExceeded>("LegacyLimitExceeded")(
  legacyFields,
  { httpApiStatus: 429 },
) {}

export class LegacyServerError extends Schema.Error<LegacyServerError>("LegacyServerError")(
  legacyFields,
  { httpApiStatus: 500 },
) {}

/** A notification that fails SNS's checks. SNS does not retry a 400. */
export class SesNotificationRejected extends Schema.Error<SesNotificationRejected>(
  "SesNotificationRejected",
)(
  {
    code: Schema.Literal("bad_request"),
    message: Schema.Literal("SES notification handling failed"),
  },
  { httpApiStatus: 400 },
) {}

/** A notification whose outcome could not be recorded. SNS retries a 500. */
export class SesNotificationFailed extends Schema.Error<SesNotificationFailed>(
  "SesNotificationFailed",
)(
  {
    code: Schema.Literal("internal_server_error"),
    message: Schema.Literal("SES notification handling failed"),
  },
  { httpApiStatus: 500 },
) {}

/** The Project an API key on `/messages/*` belongs to, and who its sends bill. */
export class CurrentProject extends Context.Service<
  CurrentProject,
  {
    readonly apiKeyId: string;
    readonly organizationId: string;
    readonly organizationOwnerUserId: string;
  }
>()("api/CurrentProject") {}

/** The Project a legacy send's API key belongs to, already checked against `:project`. */
export class LegacyProject extends Context.Service<LegacyProject, { readonly id: string }>()(
  "api/LegacyProject",
) {}

/**
 * Checks a request against its endpoint's headers and JSON payload before anything else
 * runs, so a malformed or invalid request is refused the same way whatever its API key.
 */
export class RequestValidation extends HttpApiMiddleware.Service<RequestValidation>()(
  "api/RequestValidation",
  { error: [RouteNotFound, MalformedBody, SchemaValidationFailed.pipe(HttpApiSchema.asJson())] },
) {}

/** Resolves `x-api-key` to its Project, refusing an unknown key with 403. */
export class ApiKeyAuth extends HttpApiMiddleware.Service<
  ApiKeyAuth,
  { provides: CurrentProject }
>()("api/ApiKeyAuth", { error: [InvalidApiKey.pipe(json), InternalServerError.pipe(json)] }) {}

/** Resolves the legacy key to its Project and checks it is the one in the path. */
export class LegacyApiKeyAuth extends HttpApiMiddleware.Service<
  LegacyApiKeyAuth,
  { provides: LegacyProject }
>()("api/LegacyApiKeyAuth", {
  error: [LegacyUnauthorized.pipe(json), LegacyProjectNotFound.pipe(json)],
}) {}

/** What both legacy endpoints share besides their body. */
const legacyEndpoint = {
  error: [LegacyRefused.pipe(json), LegacyLimitExceeded.pipe(json), LegacyServerError.pipe(json)],
  success: Schema.Struct({ id: Schema.String, status: Schema.Literal("queued") }).pipe(
    HttpApiSchema.status(201),
    json,
  ),
};

export class Api extends HttpApi.make("relayit")
  .add(
    HttpApiGroup.make("health")
      .add(
        HttpApiEndpoint.get("health", "/health", {
          success: Schema.Struct({ status: Schema.Literal("ok") }).pipe(json),
        }),
      )
      .annotate(OpenApi.Exclude, true),
  )
  .add(
    HttpApiGroup.make("send")
      .add(
        HttpApiEndpoint.post("sendEmail", "/messages/email", {
          error: [
            SendRefused.pipe(json),
            InvalidAppEnvironment.pipe(json),
            AcceptRefused.pipe(json),
            SendLimitExceeded.pipe(json),
            InternalServerError.pipe(json),
          ],
          ...requestSchemas.sendEmail,
          success: Schema.Struct({
            id: Schema.String,
            stripped: Schema.optionalKey(
              Schema.Array(Schema.Struct({ email: Schema.String, reason: Schema.String })),
            ),
          }).pipe(HttpApiSchema.status(201), json),
        }).annotateMerge(
          OpenApi.annotations({
            description:
              "Create a transactional email. Provide inline html/text or a template, not both.",
            summary: "Send email",
          }),
        ),
      )
      .middleware(ApiKeyAuth)
      .annotateMerge(OpenApi.annotations({ description: "Current send endpoints", title: "Send" })),
  )
  .add(
    HttpApiGroup.make("legacySend")
      .add(
        HttpApiEndpoint.post("sendRawEmail", "/send/:project/raw/email", {
          ...legacyEndpoint,
          ...requestSchemas.sendRawEmail,
        }).annotateMerge(
          OpenApi.annotations({
            description: "Compatibility send with inline html/text. Prefer POST /messages/email.",
            summary: "Send raw email",
          }),
        ),
      )
      .add(
        HttpApiEndpoint.post("sendTemplateEmail", "/send/:project/template/email", {
          ...legacyEndpoint,
          ...requestSchemas.sendTemplateEmail,
        }).annotateMerge(
          OpenApi.annotations({
            description: "Compatibility send using a Template. Prefer POST /messages/email.",
            summary: "Send template email",
          }),
        ),
      )
      .middleware(LegacyApiKeyAuth)
      .annotateMerge(
        OpenApi.annotations({
          description: "Compatibility send endpoints for existing integrations",
          title: "Legacy Send",
        }),
      ),
  )
  .add(
    HttpApiGroup.make("sesNotifications")
      .add(
        // SNS posts `text/plain` holding JSON; the handler reads the raw body whatever the
        // content type says.
        HttpApiEndpoint.post("receive", SES_NOTIFICATIONS_PATH, {
          error: [SesNotificationRejected.pipe(json), SesNotificationFailed.pipe(json)],
          success: Schema.Struct({ ok: Schema.Literal(true) }).pipe(json),
        }),
      )
      .annotate(OpenApi.Exclude, true),
  )
  // Added last, so it wraps the auth middleware and runs first.
  .middleware(RequestValidation)
  .annotateMerge(
    OpenApi.annotations({
      description:
        "HTTP API for sending messages through Relayit. Prefer POST /messages/email for new integrations.",
      title: "Relayit API",
      version: "0.0.0",
    }),
  ) {}
