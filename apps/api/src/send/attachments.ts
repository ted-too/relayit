import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP } from "node:net";
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
const MAX_PATH_REDIRECTS = 5;

const NON_PUBLIC_BLOCKLIST = new BlockList();
NON_PUBLIC_BLOCKLIST.addSubnet("0.0.0.0", 8, "ipv4");
NON_PUBLIC_BLOCKLIST.addSubnet("10.0.0.0", 8, "ipv4");
NON_PUBLIC_BLOCKLIST.addSubnet("100.64.0.0", 10, "ipv4");
NON_PUBLIC_BLOCKLIST.addSubnet("127.0.0.0", 8, "ipv4");
NON_PUBLIC_BLOCKLIST.addSubnet("169.254.0.0", 16, "ipv4");
NON_PUBLIC_BLOCKLIST.addSubnet("172.16.0.0", 12, "ipv4");
NON_PUBLIC_BLOCKLIST.addSubnet("192.0.0.0", 24, "ipv4");
NON_PUBLIC_BLOCKLIST.addSubnet("192.0.2.0", 24, "ipv4");
NON_PUBLIC_BLOCKLIST.addSubnet("192.168.0.0", 16, "ipv4");
NON_PUBLIC_BLOCKLIST.addSubnet("198.18.0.0", 15, "ipv4");
NON_PUBLIC_BLOCKLIST.addSubnet("198.51.100.0", 24, "ipv4");
NON_PUBLIC_BLOCKLIST.addSubnet("203.0.113.0", 24, "ipv4");
NON_PUBLIC_BLOCKLIST.addSubnet("224.0.0.0", 4, "ipv4");
NON_PUBLIC_BLOCKLIST.addSubnet("240.0.0.0", 4, "ipv4");
NON_PUBLIC_BLOCKLIST.addAddress("::", "ipv6");
NON_PUBLIC_BLOCKLIST.addAddress("::1", "ipv6");
NON_PUBLIC_BLOCKLIST.addSubnet("100::", 64, "ipv6");
NON_PUBLIC_BLOCKLIST.addSubnet("2001:db8::", 32, "ipv6");
NON_PUBLIC_BLOCKLIST.addSubnet("fc00::", 7, "ipv6");
NON_PUBLIC_BLOCKLIST.addSubnet("fe80::", 10, "ipv6");
NON_PUBLIC_BLOCKLIST.addSubnet("ff00::", 8, "ipv6");

type PinnedAddress = {
  address: string;
  family: 4 | 6;
};

function isNonPublicIp(ip: string): boolean {
  const version = isIP(ip);
  if (version === 4) {
    return NON_PUBLIC_BLOCKLIST.check(ip, "ipv4");
  }
  if (version === 6) {
    return NON_PUBLIC_BLOCKLIST.check(ip, "ipv6");
  }
  return true;
}

function parseAttachmentPathUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Attachment path must be a valid http(s) URL");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Attachment path must use http or https");
  }

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local")
  ) {
    throw new Error("Attachment path host is not allowed");
  }

  return url;
}

async function resolvePublicAddress(hostname: string): Promise<PinnedAddress> {
  const ipVersion = isIP(hostname);
  if (ipVersion === 4 || ipVersion === 6) {
    if (isNonPublicIp(hostname)) {
      throw new Error("Attachment path resolves to a non-public address");
    }
    return { address: hostname, family: ipVersion };
  }

  const addresses = await lookup(hostname, { all: true });
  if (addresses.length === 0) {
    throw new Error("Failed to resolve attachment path host");
  }

  for (const entry of addresses) {
    if (isNonPublicIp(entry.address)) {
      throw new Error("Attachment path resolves to a non-public address");
    }
  }

  const selected = addresses[0];
  if (!selected) {
    throw new Error("Failed to resolve attachment path host");
  }

  return {
    address: selected.address,
    family: selected.family === 6 ? 6 : 4,
  };
}

function isRedirectStatus(status: number): boolean {
  return (
    status === 301 ||
    status === 302 ||
    status === 303 ||
    status === 307 ||
    status === 308
  );
}

function pinnedRequest(
  url: URL,
  pinned: PinnedAddress,
  signal: AbortSignal
): Promise<Response> {
  const transport = url.protocol === "https:" ? https : http;
  const port = url.port
    ? Number(url.port)
    : url.protocol === "https:"
      ? 443
      : 80;

  return new Promise((resolve, reject) => {
    const req = transport.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        servername: url.hostname,
        port,
        path: `${url.pathname}${url.search}`,
        method: "GET",
        signal,
        lookup(_hostname, options, callback) {
          if (options?.all) {
            callback(null, [
              { address: pinned.address, family: pinned.family },
            ]);
            return;
          }
          callback(null, pinned.address, pinned.family);
        },
      },
      (incoming) => {
        const chunks: Buffer[] = [];
        incoming.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });
        incoming.on("end", () => {
          const headers = new Headers();
          for (const [key, value] of Object.entries(incoming.headers)) {
            if (value === undefined) {
              continue;
            }
            if (Array.isArray(value)) {
              for (const item of value) {
                headers.append(key, item);
              }
            } else {
              headers.set(key, value);
            }
          }

          resolve(
            new Response(Buffer.concat(chunks), {
              status: incoming.statusCode ?? 0,
              statusText: incoming.statusMessage,
              headers,
            })
          );
        });
      }
    );

    req.on("error", reject);
    req.end();
  });
}

async function fetchAttachmentPath(
  path: string,
  signal: AbortSignal,
  redirectsRemaining = MAX_PATH_REDIRECTS
): Promise<Response> {
  const url = parseAttachmentPathUrl(path);
  const pinned = await resolvePublicAddress(url.hostname);
  const response = await pinnedRequest(url, pinned, signal);

  if (!isRedirectStatus(response.status)) {
    return response;
  }

  if (redirectsRemaining <= 0) {
    throw new Error("Attachment path exceeded redirect limit");
  }

  const location = response.headers.get("location");
  if (!location) {
    throw new Error("Attachment path redirect missing Location header");
  }

  // Re-parse, re-resolve, and re-pin every hop to block redirect/DNS-rebind bypasses.
  return fetchAttachmentPath(
    new URL(location, url).href,
    signal,
    redirectsRemaining - 1
  );
}
const ATTACHMENTS_SIZE_LIMIT_MESSAGE = `Total attachment size exceeds ${MAX_ATTACHMENTS_BYTES} bytes (40MB)`;

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

function attachmentsSizeLimitError() {
  return createGenericError(ATTACHMENTS_SIZE_LIMIT_MESSAGE);
}

/** Upper-bound estimate of decoded Base64 byte length (before Buffer.from). */
function estimateBase64DecodedByteLength(content: string): number {
  if (content.length === 0) {
    return 0;
  }
  let padding = 0;
  if (content.endsWith("==")) {
    padding = 2;
  } else if (content.endsWith("=")) {
    padding = 1;
  }
  return Math.floor((content.length * 3) / 4) - padding;
}

async function readResponseBodyWithByteLimit(
  response: Response,
  maxBytes: number
): Promise<Result<Buffer>> {
  if (!response.body) {
    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength > maxBytes) {
      return { error: attachmentsSizeLimitError(), data: null };
    }
    return { error: null, data: Buffer.from(arrayBuffer) };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  const readChunk = async (): Promise<Result<Buffer>> => {
    const { done, value } = await reader.read();
    if (done) {
      return { error: null, data: Buffer.concat(chunks, total) };
    }

    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return { error: attachmentsSizeLimitError(), data: null };
    }

    chunks.push(value);
    return readChunk();
  };

  try {
    return await readChunk();
  } catch (error) {
    return {
      error: createGenericError(
        "Failed to read attachment response body",
        error
      ),
      data: null,
    };
  }
}

async function resolveAttachmentBytes(
  attachment: AttachmentInput,
  remainingBytes: number
): Promise<Result<ResolvedAttachment>> {
  if (attachment.content !== undefined) {
    try {
      const estimatedBytes = estimateBase64DecodedByteLength(
        attachment.content
      );
      if (estimatedBytes > remainingBytes) {
        return { error: attachmentsSizeLimitError(), data: null };
      }

      const body = Buffer.from(attachment.content, "base64");
      if (body.byteLength === 0) {
        return {
          error: createGenericError(
            `Attachment '${attachment.filename}' has empty content`
          ),
          data: null,
        };
      }
      if (body.byteLength > remainingBytes) {
        return { error: attachmentsSizeLimitError(), data: null };
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
    const response = await fetchAttachmentPath(
      attachment.path,
      AbortSignal.timeout(PATH_FETCH_TIMEOUT_MS)
    );

    if (!response.ok) {
      return {
        error: createGenericError(
          `Failed to fetch attachment '${attachment.filename}' from path`,
          `HTTP ${response.status}`
        ),
        data: null,
      };
    }

    const contentLengthHeader = response.headers.get("content-length");
    if (contentLengthHeader !== null) {
      const contentLength = Number(contentLengthHeader);
      if (Number.isFinite(contentLength) && contentLength > remainingBytes) {
        await response.body?.cancel();
        return { error: attachmentsSizeLimitError(), data: null };
      }
    }

    const bodyResult = await readResponseBodyWithByteLimit(
      response,
      remainingBytes
    );
    if (bodyResult.error) {
      return { error: bodyResult.error, data: null };
    }

    const body = bodyResult.data;
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

  const resolved: ResolvedAttachment[] = [];
  let totalBytes = 0;

  for (const attachment of attachments) {
    const result = await resolveAttachmentBytes(
      attachment,
      MAX_ATTACHMENTS_BYTES - totalBytes
    );
    if (result.error) {
      throw new HTTPException(400, { message: result.error.message });
    }

    totalBytes += result.data.body.byteLength;
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
