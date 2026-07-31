import type { ProviderEmailMessage } from "@repo/api/channels/email/types";
import type { DbOrTx } from "@repo/api/db";
import { schema } from "@repo/api/db";
import { s3, subBucket } from "@repo/api/object-storage";
import type { SendEmailBody } from "@repo/api/validators/routes/messages";
import { typeid } from "typeid-js";

const emailAttachments = subBucket({
  name: "email.attachments",
  key: (p: { deliveryId: string; attachmentId: string }) => [
    p.deliveryId,
    p.attachmentId,
  ],
});

const ATTACHMENT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ATTACHMENT_FETCH_TIMEOUT_MS = 30_000;

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  csv: "text/csv",
  gif: "image/gif",
  htm: "text/html",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  txt: "text/plain",
  webp: "image/webp",
  zip: "application/zip",
};

type RawAttachment = NonNullable<SendEmailBody["attachments"]>[number];

export type ResolvedEmailAttachment = RawAttachment & {
  bytes: Uint8Array;
  contentType: string;
};

function contentTypeFromFilename(filename: string) {
  const ext = filename.split(".").pop()?.toLowerCase();
  return (ext && EXTENSION_CONTENT_TYPES[ext]) ?? "application/octet-stream";
}

function assertAttachmentSize(bytes: Uint8Array, filename: string) {
  if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(
      `Attachment "${filename}" exceeds the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit`
    );
  }
}

export async function resolveEmailAttachment(
  attachment: RawAttachment
): Promise<ResolvedEmailAttachment> {
  const contentType =
    attachment.content_type ?? contentTypeFromFilename(attachment.filename);

  if (attachment.path) {
    const response = await fetch(attachment.path, {
      redirect: "follow",
      signal: AbortSignal.timeout(ATTACHMENT_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to fetch attachment "${attachment.filename}" from URL`
      );
    }

    const contentLength = response.headers.get("content-length");
    if (
      contentLength &&
      Number.parseInt(contentLength, 10) > MAX_ATTACHMENT_BYTES
    ) {
      throw new Error(
        `Attachment "${attachment.filename}" exceeds the ${MAX_ATTACHMENT_BYTES / (1024 * 1024)}MB limit`
      );
    }

    const bytes = new Uint8Array(await response.arrayBuffer());
    assertAttachmentSize(bytes, attachment.filename);

    return {
      ...attachment,
      bytes,
      contentType: response.headers.get("content-type") ?? contentType,
    };
  }

  const content = attachment.content ?? "";
  const bytes = Uint8Array.from(Buffer.from(content, "base64"));
  if (bytes.byteLength === 0 && content.length > 0) {
    throw new Error(`Attachment "${attachment.filename}" is not valid base64`);
  }

  assertAttachmentSize(bytes, attachment.filename);

  return {
    ...attachment,
    bytes,
    contentType,
  };
}

export function resolveEmailAttachments(
  attachments: RawAttachment[]
): Promise<ResolvedEmailAttachment[]> {
  return Promise.all(
    attachments.map((attachment) => resolveEmailAttachment(attachment))
  );
}

function attachmentExpiresAt(scheduledAt?: Date) {
  const base = scheduledAt?.getTime() ?? Date.now();
  return new Date(Math.max(base, Date.now()) + ATTACHMENT_TTL_MS);
}

export async function stageEmailAttachments({
  db,
  deliveryId,
  attachments,
  scheduledAt,
}: {
  db: DbOrTx;
  deliveryId: string;
  attachments: ResolvedEmailAttachment[];
  scheduledAt?: Date;
}): Promise<{ attachmentId: string; deliveryId: string }[]> {
  const store = emailAttachments.with(s3);
  const expiresAt = attachmentExpiresAt(scheduledAt);
  const staged: { attachmentId: string; deliveryId: string }[] = [];

  try {
    for (const attachment of attachments) {
      const attachmentId = typeid("eatc").toString();
      const upload = await store.upload(
        { deliveryId, attachmentId },
        attachment.bytes,
        { contentType: attachment.contentType }
      );

      if (upload.error) {
        throw new Error(upload.error.message);
      }

      staged.push({ attachmentId, deliveryId });

      await db.insert(schema.emailAttachment).values({
        id: attachmentId,
        emailDeliveryId: deliveryId,
        filename: attachment.filename,
        size: attachment.bytes.byteLength,
        contentType: attachment.contentType,
        contentDisposition: attachment.content_id ? "inline" : "attachment",
        contentId: attachment.content_id ?? null,
        storageKey: upload.data.key,
        expiresAt,
      });
    }

    return staged;
  } catch (error) {
    await deleteStagedEmailAttachments(staged);
    throw error;
  }
}

export async function deleteStagedEmailAttachments(
  staged: { attachmentId: string; deliveryId: string }[]
) {
  const store = emailAttachments.with(s3);

  await Promise.all(
    staged.map(({ deliveryId, attachmentId }) =>
      store.delete({ deliveryId, attachmentId })
    )
  );
}

export async function loadEmailAttachmentsForSend({
  db,
  deliveryId,
}: {
  db: DbOrTx;
  deliveryId: string;
}): Promise<NonNullable<ProviderEmailMessage["attachments"]>> {
  const rows = await db.query.emailAttachment.findMany({
    where: (table, { eq }) => eq(table.emailDeliveryId, deliveryId),
  });

  if (rows.length === 0) {
    return [];
  }

  const store = emailAttachments.with(s3);
  const attachments: NonNullable<ProviderEmailMessage["attachments"]> = [];

  for (const row of rows) {
    const download = await store.download({
      deliveryId,
      attachmentId: row.id,
    });

    if (download.error) {
      throw new Error(download.error.message);
    }

    const content = Buffer.from(download.data.body).toString("base64");

    if (row.contentDisposition === "inline" && row.contentId) {
      attachments.push({
        content,
        content_id: row.contentId,
        filename: row.filename,
      });
      continue;
    }

    attachments.push({
      content,
      filename: row.filename,
    });
  }

  return attachments;
}
