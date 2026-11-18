import { subBucket } from "@repo/object-storage";
import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import { emailAttachment } from "@repo/persistence/db/schema";
import * as NodeDnsPromises from "node:dns/promises";
import * as NodeNet from "node:net";
import { Context, DateTime, Effect, Predicate, Stream } from "effect";
import { FetchHttpClient, HttpClient } from "effect/http";
import ipaddr from "ipaddr.js";
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

const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

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

/** Every address a hosted attachment's host resolves to. Real DNS unless a test replaces it. */
export const AttachmentHostLookup = Context.Reference<{
  readonly resolve: (hostname: string) => Promise<readonly string[]>;
}>("Channels/AttachmentHostLookup", {
  defaultValue: () => ({
    resolve: async (hostname) =>
      (await NodeDnsPromises.lookup(hostname, { all: true, verbatim: true })).map(
        (entry) => entry.address,
      ),
  }),
});

// IPv6 global unicast; everything outside it (loopback, IPv4-compatible `::/96`,
// unique-local, link-local, multicast) is refused whatever its `range()`.
const GLOBAL_UNICAST_V6 = ipaddr.parseCIDR("2000::/3");

const resolveEmailAttachment = (attachment: EmailAttachmentInput, organizationId: string) =>
  Effect.gen(function* () {
    yield* assertAttachmentFilename(attachment.filename);
    const fallbackType = attachment.contentType ?? contentTypeFromFilename(attachment.filename);
    if (attachment.source.kind === "base64") {
      const content = attachment.source.content.replace(/\s/g, "");
      if (content.length % 4 !== 0 || (content.length > 0 && !BASE64_PATTERN.test(content))) {
        return yield* new EmailAcceptRejected({
          code: "invalid_attachment",
          details: {
            filename: attachment.filename,
            reason: "invalid_base64",
          },
          message: "Attachment content is not valid base64.",
        });
      }
      const bytes = Uint8Array.from(Buffer.from(content, "base64"));
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
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
      return {
        bytes,
        contentId: attachment.contentId,
        contentType: fallbackType,
        filename: attachment.filename,
      } satisfies ResolvedEmailAttachment;
    }

    // Downloaded from a public address, up to the size limit and within the timeout. The
    // host is resolved once and the request goes to that address, with the hostname as
    // `Host` and as the TLS server name the certificate is checked against, so a second
    // DNS answer can't steer it elsewhere. Redirects are refused. The client is this
    // fetch's own, not the caller's `HttpClient`, so nothing a caller provides loosens it.
    const parsed = URL.parse(attachment.source.url);
    if (parsed?.protocol !== "https:") {
      return yield* new EmailAcceptRejected({
        code: "invalid_attachment",
        details: { filename: attachment.filename, reason: "unsupported_url" },
        message: "Attachment path must be an https URL.",
      });
    }
    // The URL parser has already normalised IPv4 spellings; IPv6 keeps its brackets.
    const hostname = parsed.hostname.replace(/^\[(.*)\]$/, "$1");
    const literal = NodeNet.isIP(hostname) !== 0;
    const hostLookup = yield* AttachmentHostLookup;
    const addresses = literal
      ? [hostname]
      : yield* Effect.tryPromise({
          // A name with no address is the caller's; any other DNS failure is ours.
          catch: (cause) => {
            switch (Predicate.hasProperty(cause, "code") ? cause.code : undefined) {
              case "ENODATA":
              case "ENOTFOUND":
                return new EmailAcceptRejected({
                  code: "invalid_attachment",
                  details: { filename: attachment.filename, reason: "unresolvable_host" },
                  message: "Attachment URL's host could not be resolved.",
                });
              default:
                return new EmailAcceptInfrastructureError({
                  cause,
                  operation: "attachments",
                  organizationId,
                });
            }
          },
          try: () => hostLookup.resolve(hostname),
        });
    const [address] = addresses;
    // Only plain public unicast. Loopback, private, link-local, unique-local, CGNAT,
    // unspecified, multicast, reserved and the IPv6 ranges that embed an IPv4 address (6to4,
    // NAT64, Teredo) all have another `range()`; an IPv4-mapped IPv6 address is judged as
    // the IPv4 address it maps. One such address among public ones refuses the URL.
    const isPublic = (candidate: string) => {
      const ip = ipaddr.process(candidate);
      return ip.range() === "unicast" && (ip.kind() === "ipv4" || ip.match(GLOBAL_UNICAST_V6));
    };
    if (address === undefined || !addresses.every(isPublic)) {
      return yield* new EmailAcceptRejected({
        code: "invalid_attachment",
        details: { filename: attachment.filename, reason: "blocked_address" },
        message: "Attachment URL must resolve to a public address.",
      });
    }

    const pinned = new URL(parsed);
    pinned.hostname = NodeNet.isIP(address) === 6 ? `[${address}]` : address;
    const init: BunFetchRequestInit = {
      redirect: "error",
      ...(literal ? {} : { tls: { serverName: hostname } }),
    };

    return yield* Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      const response = yield* http.get(pinned, { headers: { host: parsed.host } });
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

      // Counted as it arrives, so a body without a Content-Length, or one that understates
      // it, is cut off at the limit rather than read whole.
      const chunks: Uint8Array[] = [];
      let received = 0;
      yield* response.stream.pipe(
        Stream.runForEach((chunk) => {
          received += chunk.byteLength;
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
          chunks.push(chunk);
          return Effect.void;
        }),
      );
      return {
        bytes: Buffer.concat(chunks, received),
        contentId: attachment.contentId,
        contentType: response.headers["content-type"] ?? fallbackType,
        filename: attachment.filename,
      } satisfies ResolvedEmailAttachment;
    }).pipe(
      Effect.provideService(FetchHttpClient.RequestInit, init),
      Effect.provide(FetchHttpClient.layer),
      Effect.timeout(ATTACHMENT_FETCH_TIMEOUT),
      Effect.catchTags({
        HttpClientError: (cause) =>
          Effect.fail(
            new EmailAcceptInfrastructureError({ cause, operation: "attachments", organizationId }),
          ),
        TimeoutError: (cause) =>
          Effect.fail(
            new EmailAcceptInfrastructureError({ cause, operation: "attachments", organizationId }),
          ),
      }),
    );
  });

export const resolveEmailAttachments = (
  attachments: readonly EmailAttachmentInput[],
  organizationId: string,
) =>
  // A few at a time: each hosted one holds up to the size limit in memory while it downloads.
  Effect.forEach(attachments, (attachment) => resolveEmailAttachment(attachment, organizationId), {
    concurrency: 4,
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
        const upload = yield* emailAttachmentsBucket.upload(stagedAttachment, attachment.bytes, {
          contentType: attachment.contentType,
        });
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
                }),
            ),
          );
        return stagedAttachment;
      }),
    { concurrency: 1 },
  ).pipe(
    Effect.catch((error) =>
      deleteStagedEmailAttachments(staged).pipe(Effect.ignore, Effect.andThen(Effect.fail(error))),
    ),
  );
};
