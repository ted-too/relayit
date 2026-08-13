import { subBucket } from "@repo/object-storage";
import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import { emailAttachment } from "@repo/persistence/db/schema";
import { DateTime, Effect } from "effect";
import { HttpClient } from "effect/unstable/http";
import { typeid } from "typeid-js";
import { z } from "zod";
import {
  ATTACHMENT_FETCH_TIMEOUT,
  ATTACHMENT_TTL_MS,
  contentTypeFromFilename,
  isBlockedAttachmentFilename,
  MAX_ATTACHMENT_BYTES,
} from "../attachment-policy";
import type { EmailAttachmentInput } from "./contracts";
import { EmailAcceptInfrastructureError, EmailAcceptRejected } from "./errors";

const BASE64_PATTERN =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

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

const assertAttachmentFilename = (
  filename: string
): Effect.Effect<void, EmailAcceptRejected> =>
  isBlockedAttachmentFilename(filename)
    ? Effect.fail(
        new EmailAcceptRejected({
          code: "invalid_attachment",
          details: { filename, reason: "blocked_extension" },
          message: "This file type isn't allowed for security reasons.",
        })
      )
    : Effect.void;

const assertAttachmentSize = (
  bytes: Uint8Array,
  filename: string
): Effect.Effect<Uint8Array, EmailAcceptRejected> =>
  bytes.byteLength <= MAX_ATTACHMENT_BYTES
    ? Effect.succeed(bytes)
    : Effect.fail(
        new EmailAcceptRejected({
          code: "invalid_attachment",
          details: {
            filename,
            maxBytes: MAX_ATTACHMENT_BYTES,
            reason: "exceeds_size_limit",
          },
          message: "Attachment exceeds the size limit.",
        })
      );

const resolveEmailAttachment = (
  attachment: EmailAttachmentInput,
  organizationId: string
) =>
  Effect.gen(function* () {
    yield* assertAttachmentFilename(attachment.filename);
    const fallbackType =
      attachment.contentType ?? contentTypeFromFilename(attachment.filename);
    if (attachment.source.kind === "base64") {
      const content = attachment.source.content.replace(/\s/g, "");
      if (
        content.length % 4 !== 0 ||
        (content.length > 0 && !BASE64_PATTERN.test(content))
      ) {
        return yield* new EmailAcceptRejected({
          code: "invalid_attachment",
          details: {
            filename: attachment.filename,
            reason: "invalid_base64",
          },
          message: "Attachment content is not valid base64.",
        });
      }
      const bytes = yield* assertAttachmentSize(
        Uint8Array.from(Buffer.from(content, "base64")),
        attachment.filename
      );
      return {
        bytes,
        contentId: attachment.contentId,
        contentType: fallbackType,
        filename: attachment.filename,
      } satisfies ResolvedEmailAttachment;
    }

    const http = yield* HttpClient.HttpClient;
    const response = yield* http.get(new URL(attachment.source.url)).pipe(
      Effect.timeout(ATTACHMENT_FETCH_TIMEOUT),
      Effect.mapError(
        (cause) =>
          new EmailAcceptInfrastructureError({
            cause,
            operation: "attachments",
            organizationId,
          })
      )
    );
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

    const contentLength = Number.parseInt(
      response.headers["content-length"] ?? "",
      10
    );
    if (
      Number.isFinite(contentLength) &&
      contentLength > MAX_ATTACHMENT_BYTES
    ) {
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

    const bytes = yield* response.arrayBuffer.pipe(
      Effect.map((body) => new Uint8Array(body)),
      Effect.flatMap((body) => assertAttachmentSize(body, attachment.filename)),
      Effect.mapError((cause) =>
        cause instanceof EmailAcceptRejected
          ? cause
          : new EmailAcceptInfrastructureError({
              cause,
              operation: "attachments",
              organizationId,
            })
      )
    );
    return {
      bytes,
      contentId: attachment.contentId,
      contentType: response.headers["content-type"] ?? fallbackType,
      filename: attachment.filename,
    } satisfies ResolvedEmailAttachment;
  });

export const resolveEmailAttachments = (
  attachments: readonly EmailAttachmentInput[],
  organizationId: string
) =>
  Effect.forEach(
    attachments,
    (attachment) => resolveEmailAttachment(attachment, organizationId),
    { concurrency: "unbounded" }
  );

export const deleteStagedEmailAttachments = (
  attachments: readonly StagedEmailAttachment[]
) =>
  Effect.forEach(
    attachments,
    (attachment) => emailAttachmentsBucket.delete(attachment),
    { concurrency: "unbounded", discard: true }
  );

export const stageEmailAttachments = (
  db: DatabaseExecutor,
  input: {
    readonly attachments: readonly ResolvedEmailAttachment[];
    readonly deliveryId: string;
    readonly now: DateTime.Utc;
    readonly organizationId: string;
    readonly scheduledAt?: DateTime.Utc;
  }
) => {
  const staged: StagedEmailAttachment[] = [];
  const scheduledMillis = input.scheduledAt
    ? DateTime.toEpochMillis(input.scheduledAt)
    : 0;
  const expiresAt = DateTime.toDate(
    DateTime.makeUnsafe(
      Math.max(DateTime.toEpochMillis(input.now), scheduledMillis) +
        ATTACHMENT_TTL_MS
    )
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
        const upload = yield* emailAttachmentsBucket.upload(
          stagedAttachment,
          attachment.bytes,
          { contentType: attachment.contentType }
        );
        staged.push(stagedAttachment);
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
                })
            )
          );
        return stagedAttachment;
      }),
    { concurrency: 1 }
  ).pipe(
    Effect.catch((error) =>
      deleteStagedEmailAttachments(staged).pipe(
        Effect.ignore,
        Effect.andThen(Effect.fail(error))
      )
    )
  );
};
