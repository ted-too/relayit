import { createHmac, timingSafeEqual } from "node:crypto";
import { DB } from "@repo/persistence/db/effect";
import { contactTopicUnsubscribe } from "@repo/persistence/db/schema";
import { Data, Effect } from "effect";

const TRAILING_SLASH = /\/$/;

const listUnsubscribePayload = (input: {
  readonly contactId: string;
  readonly messageId: string;
  readonly topicId: string;
}) => `${input.contactId}:${input.messageId}:${input.topicId}`;

export const signListUnsubscribe = (input: {
  readonly contactId: string;
  readonly messageId: string;
  readonly secret: string;
  readonly topicId: string;
}) =>
  createHmac("sha256", input.secret)
    .update(
      listUnsubscribePayload({
        contactId: input.contactId,
        messageId: input.messageId,
        topicId: input.topicId,
      })
    )
    .digest("base64url");

export const verifyListUnsubscribe = (input: {
  readonly contactId: string;
  readonly messageId: string;
  readonly secret: string;
  readonly signature: string;
  readonly topicId: string;
}) => {
  const expected = signListUnsubscribe({
    contactId: input.contactId,
    messageId: input.messageId,
    secret: input.secret,
    topicId: input.topicId,
  });
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(input.signature);

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, signatureBuffer);
};

export const buildListUnsubscribeUrl = (input: {
  readonly contactId: string;
  readonly messageId: string;
  readonly orgSlug: string;
  readonly secret: string;
  readonly topicId: string;
  readonly webOrigin: string;
}) => {
  const sig = signListUnsubscribe({
    contactId: input.contactId,
    messageId: input.messageId,
    secret: input.secret,
    topicId: input.topicId,
  });
  const params = new URLSearchParams({
    msg: input.messageId,
    sig,
    topic: input.topicId,
  });
  const origin = input.webOrigin.replace(TRAILING_SLASH, "");
  return `${origin}/unsubscribe/${encodeURIComponent(input.orgSlug)}/${encodeURIComponent(input.contactId)}?${params.toString()}`;
};

export const buildListUnsubscribeHeaders = (input: {
  readonly httpsUrl: string;
}): {
  readonly "List-Unsubscribe": string;
  readonly "List-Unsubscribe-Post": string;
} => ({
  "List-Unsubscribe": `<${input.httpsUrl}>`,
  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
});

/**
 * Merge RFC 8058 headers for a marketing single-recipient send.
 * Returns `existing` unchanged when gated conditions are not met.
 */
export const mergeListUnsubscribeHeadersForSend = (input: {
  readonly bccCount: number;
  readonly ccCount: number;
  readonly contactId: string | null;
  readonly existing: Readonly<Record<string, string>> | null | undefined;
  readonly messageId: string;
  readonly orgSlug: string | null;
  readonly purpose: "marketing" | "transactional";
  readonly secret: string;
  readonly toCount: number;
  readonly topicId: string | null;
  readonly webOrigin: string;
}): Record<string, string> | null | undefined => {
  const existing = input.existing ?? undefined;
  if (
    input.purpose !== "marketing" ||
    input.toCount !== 1 ||
    input.ccCount > 0 ||
    input.bccCount > 0 ||
    !input.contactId ||
    !input.orgSlug ||
    !input.topicId ||
    input.secret.length === 0 ||
    input.webOrigin.length === 0
  ) {
    return existing ?? input.existing;
  }

  const httpsUrl = buildListUnsubscribeUrl({
    contactId: input.contactId,
    messageId: input.messageId,
    orgSlug: input.orgSlug,
    secret: input.secret,
    topicId: input.topicId,
    webOrigin: input.webOrigin,
  });

  return {
    ...(existing ?? {}),
    ...buildListUnsubscribeHeaders({ httpsUrl }),
  };
};

export class ListUnsubscribeError extends Data.TaggedError(
  "ListUnsubscribeError"
)<{
  readonly cause?: unknown;
  readonly code: "bad_request" | "invalid_signature" | "not_found";
  readonly message: string;
}> {}

export const handleListUnsubscribeOneClick = (input: {
  readonly contactId: string;
  readonly messageId: string;
  readonly orgSlug: string;
  readonly secret: string;
  readonly signature: string;
  readonly topicId: string;
}) =>
  Effect.gen(function* () {
    if (
      !verifyListUnsubscribe({
        contactId: input.contactId,
        messageId: input.messageId,
        secret: input.secret,
        signature: input.signature,
        topicId: input.topicId,
      })
    ) {
      return yield* new ListUnsubscribeError({
        code: "invalid_signature",
        message: "Invalid unsubscribe signature",
      });
    }

    const db = yield* DB;

    const organization = yield* db.query.organization
      .findFirst({
        columns: { id: true, slug: true },
        where: { slug: input.orgSlug },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ListUnsubscribeError({
              cause,
              code: "bad_request",
              message: "Unsubscribe lookup failed",
            })
        )
      );

    if (!organization) {
      return yield* new ListUnsubscribeError({
        code: "not_found",
        message: "Project not found",
      });
    }

    const contact = yield* db.query.contact
      .findFirst({
        columns: { deletedAt: true, id: true },
        where: { id: input.contactId },
        with: {
          appEnvironment: {
            columns: { organizationId: true },
          },
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ListUnsubscribeError({
              cause,
              code: "bad_request",
              message: "Unsubscribe lookup failed",
            })
        )
      );

    if (contact?.appEnvironment?.organizationId !== organization.id) {
      return yield* new ListUnsubscribeError({
        code: "not_found",
        message: "Contact not found",
      });
    }

    const topic = yield* db.query.topic
      .findFirst({
        columns: { id: true, organizationId: true },
        where: {
          id: input.topicId,
          organizationId: organization.id,
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ListUnsubscribeError({
              cause,
              code: "bad_request",
              message: "Unsubscribe lookup failed",
            })
        )
      );

    if (!topic) {
      return yield* new ListUnsubscribeError({
        code: "not_found",
        message: "Topic not found",
      });
    }

    const message = yield* db.query.message
      .findFirst({
        columns: { id: true, purpose: true },
        where: { id: input.messageId },
        with: {
          appEnvironment: {
            columns: { organizationId: true },
          },
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ListUnsubscribeError({
              cause,
              code: "bad_request",
              message: "Unsubscribe lookup failed",
            })
        )
      );

    if (message?.appEnvironment?.organizationId !== organization.id) {
      return yield* new ListUnsubscribeError({
        code: "not_found",
        message: "Message not found",
      });
    }

    if (message.purpose !== "marketing") {
      return yield* new ListUnsubscribeError({
        code: "bad_request",
        message: "List-Unsubscribe applies to Campaign Messages only",
      });
    }

    yield* db
      .insert(contactTopicUnsubscribe)
      .values({
        contactId: contact.id,
        topicId: topic.id,
      })
      .onConflictDoNothing({
        target: [
          contactTopicUnsubscribe.contactId,
          contactTopicUnsubscribe.topicId,
        ],
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ListUnsubscribeError({
              cause,
              code: "bad_request",
              message: "Unsubscribe write failed",
            })
        )
      );

    return {
      contactId: contact.id,
      ok: true as const,
      topicId: topic.id,
    };
  });
