import { acceptTransactionalEmail } from "@repo/channels/email/accept";
import { logEffectFailure } from "@repo/logging";
import { Cause, DateTime, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import {
  AcceptRefused,
  Api,
  CurrentProject,
  InternalServerError,
  InvalidAppEnvironment,
  SendLimitExceeded,
  SendRefused,
} from "../../api";
import { type EmailContact, parseEmailFrom, refineSendEmailBody } from "./validators/email";

const contactInput = (contact: EmailContact) => ({
  email: contact.email,
  firstName: contact.first_name,
  lastName: contact.last_name,
  properties: contact.properties,
});

const asContactList = (value: EmailContact | string | readonly (EmailContact | string)[]) => {
  const items = Array.isArray(value) ? value : [value];
  return items.map((item) => (typeof item === "string" ? { email: item } : item));
};

/** `POST /messages/email`. `accept` is the one the api sends with, unless a test swaps it. */
export const sendHandlers = (accept = acceptTransactionalEmail) =>
  HttpApiBuilder.group(Api, "send", (handlers) =>
    Effect.succeed(
      handlers.handle("sendEmail", ({ headers, payload: body }) =>
        Effect.gen(function* () {
          const refused = refineSendEmailBody(body);
          if (refused !== undefined) {
            return yield* new SendRefused({ message: refused, on: "body", type: "validation" });
          }
          if (Boolean(headers.app) !== Boolean(headers.environment)) {
            return yield* new InvalidAppEnvironment({
              code: "invalid_app_environment",
              message: "App and Environment headers must both be present, or both omitted.",
            });
          }
          const { organizationId } = yield* CurrentProject;

          const accepted = yield* accept({
            attribution:
              headers.app && headers.environment
                ? { app: headers.app, environment: headers.environment, kind: "appEnvironment" }
                : { kind: "project" },
            email: {
              attachments: (body.attachments ?? []).map((attachment) => ({
                contentId: attachment.content_id,
                contentType: attachment.content_type,
                filename: attachment.filename,
                source:
                  attachment.path === undefined
                    ? { content: attachment.content, kind: "base64" as const }
                    : { kind: "url" as const, url: attachment.path },
              })),
              bcc: (body.bcc === undefined ? [] : asContactList(body.bcc)).map(contactInput),
              cc: (body.cc === undefined ? [] : asContactList(body.cc)).map(contactInput),
              content: body.template
                ? {
                    idOrSlug: body.template.id,
                    kind: "template",
                    subjectOverride: body.subject,
                    values: body.template.variables,
                  }
                : {
                    html: body.html,
                    kind: "inline",
                    subject: body.subject ?? "",
                    text: body.text,
                  },
              from: parseEmailFrom(body.from),
              headers: body.headers ?? {},
              replyTo:
                body.reply_to === undefined
                  ? []
                  : typeof body.reply_to === "string"
                    ? [body.reply_to]
                    : [...body.reply_to],
              to: asContactList(body.to).map(contactInput),
            },
            idempotencyKey: headers["idempotency-key"],
            organizationId,
            scheduledAt: body.scheduled_at ? DateTime.makeUnsafe(body.scheduled_at) : undefined,
            tags:
              body.tags === undefined
                ? undefined
                : Object.fromEntries(body.tags.map((tag) => [tag.name, tag.value])),
          }).pipe(
            Effect.catch((error) =>
              Effect.gen(function* () {
                switch (error._tag) {
                  case "EmailAcceptRejected": {
                    const details = error.details;
                    return yield* new AcceptRefused({
                      code: error.code,
                      message: error.message,
                      ...(details
                        ? {
                            details: {
                              ...(details.detail === undefined ? {} : { detail: details.detail }),
                              ...(details.filename === undefined
                                ? {}
                                : { filename: details.filename }),
                              ...(details.maxBytes === undefined
                                ? {}
                                : { max_bytes: details.maxBytes }),
                              ...(details.reason === undefined ? {} : { reason: details.reason }),
                              ...(details.status === undefined ? {} : { status: details.status }),
                              ...(details.variable === undefined
                                ? {}
                                : { variable: details.variable }),
                            },
                          }
                        : {}),
                    });
                  }
                  case "UsageLimitExceeded":
                    return yield* new SendLimitExceeded({
                      code:
                        error.window === "daily"
                          ? "daily_limit_exceeded"
                          : "monthly_limit_exceeded",
                      message:
                        error.window === "daily"
                          ? "Daily email send limit exceeded"
                          : "Monthly email send limit exceeded",
                      retry_after_seconds: Math.max(
                        1,
                        Math.ceil(
                          (error.retryAt.getTime() - DateTime.toEpochMillis(DateTime.nowUnsafe())) /
                            1000,
                        ),
                      ),
                    });
                  default:
                    yield* logEffectFailure("Email acceptance failed")(Cause.fail(error));
                    return yield* new InternalServerError({
                      code: "internal_server_error",
                      message: "Failed to accept email message.",
                    });
                }
              }),
            ),
            Effect.annotateLogs({ organizationId }),
          );

          return {
            id: accepted.messageId,
            ...(accepted.stripped.length > 0 ? { stripped: accepted.stripped } : {}),
          };
        }),
      ),
    ),
  );
