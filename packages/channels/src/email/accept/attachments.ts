import { subBucket } from "@repo/object-storage";
import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import { emailAttachment } from "@repo/persistence/db/schema";
import { requestPublicUrl } from "@repo/public-url";
import { DateTime, Duration, Effect, Predicate, Result, Stream } from "effect";
import { HttpClientRequest } from "effect/http";
import { typeid } from "typeid-js";
import { z } from "zod";
import {
  ATTACHMENTS_DEADLINE_SECONDS,
  ATTACHMENT_TTL_MS,
  contentTypeFromFilename,
  isBlockedAttachmentFilename,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "../attachment-policy";
import type { EmailAttachmentInput } from "./contracts";
import { EmailAcceptInfrastructureError, EmailAcceptRejected } from "./errors";

export const emailAttachmentsBucket = subBucket({
  key: ({ attachmentId, deliveryId }) => [deliveryId, attachmentId],
  name: ["email", "attachments"],
  schema: z.object({
    attachmentId: z.string(),
    deliveryId: z.string(),
  }),
});

export interface ResolvedEmailAttachment {
  readonly bytes: Uint8Array;
  readonly contentId?: string;
  readonly contentType: string;
  readonly filename: string;
}

export interface StagedEmailAttachment {
  readonly attachmentId: string;
  readonly deliveryId: string;
}

const assertAttachmentFilename = (filename: string): Effect.Effect<void, EmailAcceptRejected> =>
  isBlockedAttachmentFilename(filename)
    ? Effect.fail(
        new EmailAcceptRejected({
          code: "invalid_attachment",
          details: { filename, reason: "blocked_extension" },
          message: "This file type isn't allowed for security reasons.",
        }),
      )
    : Effect.void;

/**
 * Each attachment's bytes: base64 decoded, or downloaded from its `https:` URL. One send's
 * attachments together stay under `MAX_TOTAL_ATTACHMENT_BYTES`, counted as inline ones are
 * sized and hosted ones arrive; passing it fails the send, which interrupts the downloads
 * still running. A few at a time, so one send holds few partial downloads at once.
 */
export const resolveEmailAttachments = (
  attachments: readonly EmailAttachmentInput[],
  organizationId: string,
) =>
  // Counted afresh each time the effect runs.
  Effect.suspend(() => {
    let total = 0;
    const count = (bytes: number) => {
      total += bytes;
      return total <= MAX_TOTAL_ATTACHMENT_BYTES
        ? Effect.void
        : Effect.fail(
            new EmailAcceptRejected({
              code: "invalid_attachment",
              details: { maxBytes: MAX_TOTAL_ATTACHMENT_BYTES, reason: "exceeds_total_size_limit" },
              message: "Attachments together exceed the size limit.",
            }),
          );
    };

    return Effect.forEach(
      attachments,
      (attachment) =>
        Effect.gen(function* () {
          yield* assertAttachmentFilename(attachment.filename);
          const fallbackType =
            attachment.contentType ?? contentTypeFromFilename(attachment.filename);
          if (attachment.source.kind === "base64") {
            const content = attachment.source.content.replace(/\s/g, "");
            // Sized from its length, before anything is decoded.
            const padding = content.endsWith("==") ? 2 : content.endsWith("=") ? 1 : 0;
            const size = (content.length / 4) * 3 - padding;
            if (size > MAX_ATTACHMENT_BYTES) {
              return yield* new EmailAcceptRejected({
                code: "invalid_attachment",
                details: {
                  filename: attachment.filename,
                  maxBytes: MAX_ATTACHMENT_BYTES,
                  reason: "exceeds_size_limit",
                },
                message: "Attachment exceeds the size limit.",
              });
            }
            // Decoded without a regex over the whole string: Bun's engine refuses valid
            // base64 past 2^23 characters. `fromBase64` takes only the standard alphabet,
            // with padding at the end alone; it would also take a missing pad.
            const bytes =
              content.length % 4 === 0
                ? Result.try(() => Uint8Array.fromBase64(content))
                : Result.fail(undefined);
            if (Result.isFailure(bytes)) {
              return yield* new EmailAcceptRejected({
                code: "invalid_attachment",
                details: { filename: attachment.filename, reason: "invalid_base64" },
                message: "Attachment content is not valid base64.",
              });
            }
            yield* count(size);
            return {
              bytes: bytes.success,
              contentId: attachment.contentId,
              contentType: fallbackType,
              filename: attachment.filename,
            } satisfies ResolvedEmailAttachment;
          }

          const { url } = attachment.source;
          // Downloaded from a public address, up to the size limit, within the send's
          // deadline: `requestPublicUrl` takes only an `https:` URL, checks every address
          // its host resolves to and sends the request to one of them.
          return yield* Effect.gen(function* () {
            const response = yield* requestPublicUrl(url, HttpClientRequest.get);
            if (response.status >= 300 && response.status < 400) {
              return yield* new EmailAcceptRejected({
                code: "invalid_attachment",
                details: {
                  filename: attachment.filename,
                  reason: "redirect_refused",
                  status: response.status,
                },
                message: "Attachment URL redirects; link to the file itself.",
              });
            }
            if (response.status < 200 || response.status >= 300) {
              return yield* new EmailAcceptRejected({
                code: "invalid_attachment",
                details: {
                  filename: attachment.filename,
                  reason: "fetch_failed",
                  status: response.status,
                },
                message: "Failed to fetch attachment from URL.",
              });
            }

            const contentLength = Number.parseInt(response.headers["content-length"] ?? "", 10);
            if (Number.isFinite(contentLength) && contentLength > MAX_ATTACHMENT_BYTES) {
              return yield* new EmailAcceptRejected({
                code: "invalid_attachment",
                details: {
                  filename: attachment.filename,
                  maxBytes: MAX_ATTACHMENT_BYTES,
                  reason: "exceeds_size_limit",
                },
                message: "Attachment exceeds the size limit.",
              });
            }

            // Counted as it arrives, so a body without a Content-Length, or one that
            // understates it, is cut off at the limit rather than read whole. It grows one
            // buffer in place, which reserves its maximum without committing it, and hands
            // that buffer over at the end, so the body is never copied whole.
            const body = new ArrayBuffer(0, { maxByteLength: MAX_ATTACHMENT_BYTES });
            yield* response.stream.pipe(
              Stream.runForEach((chunk) => {
                const received = body.byteLength + chunk.byteLength;
                if (received > MAX_ATTACHMENT_BYTES) {
                  return Effect.fail(
                    new EmailAcceptRejected({
                      code: "invalid_attachment",
                      details: {
                        filename: attachment.filename,
                        maxBytes: MAX_ATTACHMENT_BYTES,
                        reason: "exceeds_size_limit",
                      },
                      message: "Attachment exceeds the size limit.",
                    }),
                  );
                }
                return count(chunk.byteLength).pipe(
                  Effect.andThen(
                    Effect.sync(() => {
                      body.resize(received);
                      new Uint8Array(body, received - chunk.byteLength).set(chunk);
                    }),
                  ),
                );
              }),
              // A response without a body (a 204) is an empty file, as it always was.
              Effect.catchReason("HttpClientError", "EmptyBodyError", () => Effect.void),
            );
            return {
              bytes: new Uint8Array(body.transferToFixedLength()),
              contentId: attachment.contentId,
              contentType: response.headers["content-type"] ?? fallbackType,
              filename: attachment.filename,
            } satisfies ResolvedEmailAttachment;
          }).pipe(
            // What failed is the customer's URL: no address connected, or the body broke
            // off. A request this code couldn't build, or a lookup that failed, is ours.
            Effect.catchTags({
              PublicHostLookupFailed: ({ cause }) =>
                Effect.fail(
                  new EmailAcceptInfrastructureError({
                    cause,
                    operation: "attachments",
                    organizationId,
                  }),
                ),
              PublicUrlRefused: (refused) => {
                if (refused.reason === "unsupported_url") {
                  return Effect.fail(
                    new EmailAcceptRejected({
                      code: "invalid_attachment",
                      details: { filename: attachment.filename, reason: "unsupported_url" },
                      message: "Attachment path must be an https URL.",
                    }),
                  );
                }
                const blocked = Effect.fail(
                  new EmailAcceptRejected({
                    code: "invalid_attachment",
                    details: { filename: attachment.filename, reason: "blocked_address" },
                    message: "Attachment URL's host has no public address.",
                  }),
                );
                // One answer whether the name exists or not, so a key holder can't learn
                // which internal names Relayit's resolver knows; the log keeps the
                // difference. A hostname too long to exist is not logged: nothing bounds it.
                return refused.reason === "hostname_too_long"
                  ? blocked
                  : Effect.logInfo("Attachment host has no public address").pipe(
                      Effect.annotateLogs({ host: refused.host, resolved: refused.resolved }),
                      Effect.andThen(blocked),
                    );
              },
              HttpClientError: (cause) => {
                switch (cause.reason._tag) {
                  case "DecodeError":
                  case "TransportError": {
                    // Logged so a fault on Relayit's side (its egress, its CA store) shows
                    // up, though each send answers 422. The error's code and the host only:
                    // its message and request carry the URL, whose query may hold a token.
                    const failure = cause.reason.cause;
                    return Effect.logWarning("Attachment URL fetch failed").pipe(
                      Effect.annotateLogs({
                        code: Predicate.hasProperty(failure, "code") ? String(failure.code) : "",
                        failure: cause.reason._tag,
                        host: new URL(url).host,
                        name: Predicate.hasProperty(failure, "name") ? String(failure.name) : "",
                      }),
                      Effect.andThen(
                        Effect.fail(
                          new EmailAcceptRejected({
                            code: "invalid_attachment",
                            details: { filename: attachment.filename, reason: "fetch_failed" },
                            message: "Failed to fetch attachment from URL.",
                          }),
                        ),
                      ),
                    );
                  }
                  default:
                    return Effect.fail(
                      new EmailAcceptInfrastructureError({
                        cause,
                        operation: "attachments",
                        organizationId,
                      }),
                    );
                }
              },
            }),
          );
        }),
      { concurrency: 4 },
    ).pipe(
      Effect.timeout(Duration.seconds(ATTACHMENTS_DEADLINE_SECONDS)),
      Effect.catchTags({
        TimeoutError: () =>
          Effect.fail(
            new EmailAcceptRejected({
              code: "invalid_attachment",
              details: { reason: "fetch_timeout" },
              message: "Attachments did not finish within the time limit.",
            }),
          ),
      }),
    );
  });

export const deleteStagedEmailAttachments = (attachments: readonly StagedEmailAttachment[]) =>
  Effect.forEach(attachments, (attachment) => emailAttachmentsBucket.delete(attachment), {
    concurrency: "unbounded",
    discard: true,
  });

export const stageEmailAttachments = (
  db: DatabaseExecutor,
  input: {
    readonly attachments: readonly ResolvedEmailAttachment[];
    readonly deliveryId: string;
    readonly now: DateTime.Utc;
    readonly organizationId: string;
    readonly scheduledAt?: DateTime.Utc;
  },
) => {
  const staged: StagedEmailAttachment[] = [];
  const scheduledMillis = input.scheduledAt ? DateTime.toEpochMillis(input.scheduledAt) : 0;
  const expiresAt = DateTime.toDate(
    DateTime.makeUnsafe(
      Math.max(DateTime.toEpochMillis(input.now), scheduledMillis) + ATTACHMENT_TTL_MS,
    ),
  );

  return Effect.forEach(
    input.attachments,
    (attachment) =>
      Effect.gen(function* () {
        const attachmentId = typeid("eatc").toString();
        const stagedAttachment = {
          attachmentId,
          deliveryId: input.deliveryId,
        };
        // Recorded before the upload: one interrupted mid-flight may still land, and only what
        // is recorded here is deleted. Deleting an object that never landed is harmless.
        staged.push(stagedAttachment);
        const upload = yield* emailAttachmentsBucket.upload(stagedAttachment, attachment.bytes, {
          contentType: attachment.contentType,
        });
        yield* db
          .insert(emailAttachment)
          .values({
            contentDisposition: attachment.contentId ? "inline" : "attachment",
            contentId: attachment.contentId ?? null,
            contentType: attachment.contentType,
            emailDeliveryId: input.deliveryId,
            expiresAt,
            filename: attachment.filename,
            id: attachmentId,
            size: attachment.bytes.byteLength,
            storageKey: upload.key,
          })
          .pipe(
            Effect.mapError(
              (cause) =>
                new EmailAcceptInfrastructureError({
                  cause,
                  operation: "attachments",
                  organizationId: input.organizationId,
                }),
            ),
          );
        return stagedAttachment;
      }),
    { concurrency: 1 },
  ).pipe(
    // Also on an interrupt: what this uploaded is not yet the caller's to clean up.
    Effect.onError(() => deleteStagedEmailAttachments(staged).pipe(Effect.ignore)),
  );
};
