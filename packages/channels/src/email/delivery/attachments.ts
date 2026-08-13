import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import { Effect } from "effect";
import { emailAttachmentsBucket } from "../accept/attachments";
import type { ProviderEmailAttachment } from "../provider-message";
import { EmailDeliveryPersistenceError } from "./errors";

export const loadEmailAttachmentsForSend = (
  db: DatabaseExecutor,
  deliveryId: string
) =>
  Effect.gen(function* () {
    const rows = yield* db.query.emailAttachment
      .findMany({
        where: { emailDeliveryId: deliveryId },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new EmailDeliveryPersistenceError({
              cause,
              deliveryId,
              operation: "load_attachments",
            })
        )
      );

    if (rows.length === 0) {
      return [] as readonly ProviderEmailAttachment[];
    }

    return yield* Effect.forEach(
      rows,
      (row) =>
        Effect.gen(function* () {
          const downloaded = yield* emailAttachmentsBucket
            .download({
              attachmentId: row.id,
              deliveryId,
            })
            .pipe(
              Effect.mapError(
                (cause) =>
                  new EmailDeliveryPersistenceError({
                    cause,
                    deliveryId,
                    operation: "load_attachments",
                  })
              )
            );
          const content = Buffer.from(downloaded.body).toString("base64");
          return {
            content,
            contentId:
              row.contentDisposition === "inline"
                ? (row.contentId ?? undefined)
                : undefined,
            contentType: row.contentType ?? undefined,
            filename: row.filename,
          } satisfies ProviderEmailAttachment;
        }),
      { concurrency: 1 }
    );
  });
