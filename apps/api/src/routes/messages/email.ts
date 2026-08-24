import { acceptTransactionalEmail } from "@repo/channels/email/accept";
import { Cause, DateTime, Effect } from "effect";
import { Elysia, status } from "elysia";
import { createApiKeyMiddleware } from "../../lib/api-key";
import type { ApiAuth } from "../../lib/auth";
import type { RunApiEffect } from "../../lib/effect";
import { logEffectFailure } from "../../lib/log-failure";
import {
  sendEmailBodySchema,
  sendEmailHeadersSchema,
} from "./validators/email";

const contactInput = (contact: {
  readonly email: string;
  readonly first_name?: string;
  readonly last_name?: string;
  readonly properties?: Readonly<Record<string, string>>;
}) => ({
  email: contact.email,
  firstName: contact.first_name,
  lastName: contact.last_name,
  properties: contact.properties,
});

export const createEmailRoutes = (
  auth: ApiAuth,
  runEffect: RunApiEffect,
  accept = acceptTransactionalEmail
) =>
  new Elysia({ prefix: "/email", tags: ["Send"] })
    .use(createApiKeyMiddleware(auth))
    .post(
      "/",
      ({ body, headers, organizationId, request }) => {
        const hasApp = Boolean(headers.app);
        const hasEnvironment = Boolean(headers.environment);
        if (hasApp !== hasEnvironment) {
          return status(400, {
            code: "invalid_app_environment",
            message:
              "App and Environment headers must both be present, or both omitted.",
          });
        }

        return runEffect(
          accept({
            attribution:
              headers.app && headers.environment
                ? {
                    app: headers.app,
                    environment: headers.environment,
                    kind: "appEnvironment",
                  }
                : { kind: "project" },
            email: {
              attachments: (body.attachments ?? []).map((attachment) => ({
                contentId: attachment.content_id,
                contentType: attachment.content_type,
                filename: attachment.filename,
                source:
                  attachment.content === undefined
                    ? { kind: "url" as const, url: attachment.path ?? "" }
                    : { content: attachment.content, kind: "base64" as const },
              })),
              bcc: (body.bcc ?? []).map(contactInput),
              cc: (body.cc ?? []).map(contactInput),
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
              from: body.from,
              headers: body.headers ?? {},
              replyTo: body.reply_to ?? [],
              to: body.to.map(contactInput),
            },
            idempotencyKey: headers["idempotency-key"],
            organizationId,
            scheduledAt: body.scheduled_at
              ? DateTime.makeUnsafe(body.scheduled_at)
              : undefined,
            tags: body.tags,
          }).pipe(
            Effect.annotateLogs({ organizationId }),
            Effect.map((accepted) =>
              status(201, {
                id: accepted.messageId,
                ...(accepted.stripped.length > 0
                  ? { stripped: accepted.stripped }
                  : {}),
              })
            ),
            Effect.catch((error) =>
              Effect.gen(function* () {
                switch (error._tag) {
                  case "EmailAcceptRejected":
                    return status(422, {
                      code: error.code,
                      message: error.message,
                      ...(error.details
                        ? {
                            details: {
                              ...(error.details.detail === undefined
                                ? {}
                                : { detail: error.details.detail }),
                              ...(error.details.filename === undefined
                                ? {}
                                : { filename: error.details.filename }),
                              ...(error.details.maxBytes === undefined
                                ? {}
                                : { max_bytes: error.details.maxBytes }),
                              ...(error.details.reason === undefined
                                ? {}
                                : { reason: error.details.reason }),
                              ...(error.details.status === undefined
                                ? {}
                                : { status: error.details.status }),
                              ...(error.details.variable === undefined
                                ? {}
                                : { variable: error.details.variable }),
                            },
                          }
                        : {}),
                    });
                  case "UsageLimitExceeded":
                    return status(429, {
                      code:
                        error.window === "daily"
                          ? "daily_limit_exceeded"
                          : "monthly_limit_exceeded",
                      message: `${error.window === "daily" ? "Daily" : "Monthly"} email send limit exceeded`,
                      retry_after_seconds: Math.max(
                        1,
                        Math.ceil(
                          (error.retryAt.getTime() -
                            DateTime.toEpochMillis(DateTime.nowUnsafe())) /
                            1000
                        )
                      ),
                    });
                  default:
                    yield* logEffectFailure("Email acceptance failed")(
                      Cause.fail(error)
                    );
                    return status(500, {
                      code: "internal_server_error",
                      message: "Failed to accept email message.",
                    });
                }
              })
            )
          ),
          { signal: request.signal }
        );
      },
      {
        apiKey: true,
        body: sendEmailBodySchema,
        headers: sendEmailHeadersSchema,
      }
    );
