import {
  type AttachmentInput,
  MAX_ATTACHMENTS_BYTES,
  type StoredAttachment,
} from "@repo/shared/providers";
import {
  buildAttachmentStorageKey,
  createBunnyAttachmentStorage,
} from "@repo/shared/storage";
import { createGenericError, type Result } from "@repo/shared/utils";
import { HTTPException } from "hono/http-exception";
import { typeid } from "typeid-js";

const PATH_FETCH_TIMEOUT_MS = 30_000;

const EXTENSION_CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  txt: "text/plain",
  csv: "text/csv",
  html: "text/html",
  json: "application/json",
  zip: "application/zip",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

type ResolvedAttachment = {
  body: Buffer;
  filename: string;
  contentType: string;
  contentId?: string;
};

function getBunnyStorage() {
  return createBunnyAttachmentStorage({
    endpoint: Bun.env.BUNNY_S3_ENDPOINT,
    region: Bun.env.BUNNY_S3_REGION,
    accessKeyId: Bun.env.BUNNY_S3_ACCESS_KEY_ID,
    secretAccessKey: Bun.env.BUNNY_S3_SECRET_ACCESS_KEY,
    bucket: Bun.env.BUNNY_S3_BUCKET,
  });
}

function guessContentType(filename: string, fallback?: string): string {
  if (fallback) {
    return fallback;
  }
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (extension && EXTENSION_CONTENT_TYPES[extension]) {
    return EXTENSION_CONTENT_TYPES[extension];
  }
  return "application/octet-stream";
}

async function resolveAttachmentBytes(
  attachment: AttachmentInput
): Promise<Result<ResolvedAttachment>> {
  if (attachment.content !== undefined) {
    try {
      const body = Buffer.from(attachment.content, "base64");
      if (body.byteLength === 0) {
        return {
          error: createGenericError(
            `Attachment '${attachment.filename}' has empty content`
          ),
          data: null,
        };
      }
      return {
        error: null,
        data: {
          body,
          filename: attachment.filename,
          contentType: guessContentType(
            attachment.filename,
            attachment.contentType
          ),
          contentId: attachment.contentId,
        },
      };
    } catch (error) {
      return {
        error: createGenericError(
          `Failed to decode Base64 content for '${attachment.filename}'`,
          error
        ),
        data: null,
      };
    }
  }

  if (!attachment.path) {
    return {
      error: createGenericError(
        `Attachment '${attachment.filename}' is missing content and path`
      ),
      data: null,
    };
  }

  try {
    const response = await fetch(attachment.path, {
      signal: AbortSignal.timeout(PATH_FETCH_TIMEOUT_MS),
    });

    if (!response.ok) {
      return {
        error: createGenericError(
          `Failed to fetch attachment '${attachment.filename}' from path`,
          `HTTP ${response.status}`
        ),
        data: null,
      };
    }

    const arrayBuffer = await response.arrayBuffer();
    const body = Buffer.from(arrayBuffer);
    if (body.byteLength === 0) {
      return {
        error: createGenericError(
          `Attachment '${attachment.filename}' fetched from path is empty`
        ),
        data: null,
      };
    }

    const headerContentType = response.headers.get("content-type") ?? undefined;
    const contentType = guessContentType(
      attachment.filename,
      attachment.contentType ?? headerContentType?.split(";")[0]?.trim()
    );

    return {
      error: null,
      data: {
        body,
        filename: attachment.filename,
        contentType,
        contentId: attachment.contentId,
      },
    };
  } catch (error) {
    return {
      error: createGenericError(
        `Failed to fetch attachment '${attachment.filename}' from path`,
        error
      ),
      data: null,
    };
  }
}

export type IngestAttachmentsParams = {
  organizationId: string;
  messageId: string;
  attachments?: AttachmentInput[];
};

export async function cleanupStoredAttachments(
  attachments: StoredAttachment[] | undefined
): Promise<void> {
  if (!attachments?.length) {
    return;
  }
  const storage = getBunnyStorage();
  await storage.deleteMany(attachments.map((a) => a.storageKey));
}

/**
 * Resolve attachment bytes, enforce size limits, upload to Bunny S3.
 * Returns stored metadata for message.payload. On failure, best-effort deletes uploaded keys.
 */
export async function ingestAttachments(
  params: IngestAttachmentsParams
): Promise<StoredAttachment[] | undefined> {
  const { attachments, organizationId, messageId } = params;

  if (!attachments?.length) {
    return;
  }

  const resolveResults = await Promise.all(
    attachments.map((attachment) => resolveAttachmentBytes(attachment))
  );

  const resolved: ResolvedAttachment[] = [];
  let totalBytes = 0;

  for (const result of resolveResults) {
    if (result.error) {
      throw new HTTPException(400, { message: result.error.message });
    }

    totalBytes += result.data.body.byteLength;
    if (totalBytes > MAX_ATTACHMENTS_BYTES) {
      throw new HTTPException(400, {
        message: `Total attachment size exceeds ${MAX_ATTACHMENTS_BYTES} bytes (40MB)`,
      });
    }

    resolved.push(result.data);
  }

  const storage = getBunnyStorage();

  const prepared = resolved.map((item) => ({
    item,
    storageKey: buildAttachmentStorageKey({
      organizationId,
      messageId,
      filename: item.filename,
      uniqueId: typeid("att").toString(),
    }),
  }));

  const uploadResults = await Promise.all(
    prepared.map(({ item, storageKey }) =>
      storage
        .put({
          key: storageKey,
          body: item.body,
          contentType: item.contentType,
        })
        .then((result) => ({ result, storageKey, item }))
    )
  );

  const uploadedKeys = uploadResults
    .filter(({ result }) => !result.error)
    .map(({ storageKey }) => storageKey);

  const failedUpload = uploadResults.find(({ result }) => result.error);
  if (failedUpload?.result.error) {
    if (uploadedKeys.length > 0) {
      await storage.deleteMany(uploadedKeys);
    }
    throw new HTTPException(500, {
      message: failedUpload.result.error.message,
    });
  }

  return prepared.map(({ item, storageKey }) => ({
    storageKey,
    filename: item.filename,
    contentType: item.contentType,
    contentId: item.contentId,
    size: item.body.byteLength,
  }));
}

export function createMessageId(): string {
  return typeid("mesg").toString();
}
