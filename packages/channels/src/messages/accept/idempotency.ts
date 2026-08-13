import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import { messageIdempotency } from "@repo/persistence/db/schema";
import { eq } from "drizzle-orm";
import { DateTime, Effect } from "effect";
import { MessageAcceptPersistenceError } from "./errors";

export interface MessageIdempotencyInput {
  readonly key: string;
  readonly now: DateTime.Utc;
  readonly organizationId: string;
}

export interface RecordMessageIdempotencyInput extends MessageIdempotencyInput {
  readonly messageId: string;
}

export type RecordMessageIdempotencyResult =
  | { readonly kind: "recorded" }
  | { readonly kind: "replay"; readonly messageId: string };

const findRecord = (db: DatabaseExecutor, input: MessageIdempotencyInput) =>
  db.query.messageIdempotency
    .findFirst({
      columns: {
        expiresAt: true,
        id: true,
        messageId: true,
      },
      where: {
        key: input.key,
        organizationId: input.organizationId,
      },
    })
    .pipe(
      Effect.mapError(
        (cause) =>
          new MessageAcceptPersistenceError({
            cause,
            operation: "find_idempotency",
            organizationId: input.organizationId,
          })
      )
    );

export const findMessageReplay = (
  db: DatabaseExecutor,
  input: MessageIdempotencyInput
) =>
  Effect.gen(function* () {
    const record = yield* findRecord(db, input);
    if (!record) {
      return;
    }
    if (record.expiresAt.getTime() > DateTime.toEpochMillis(input.now)) {
      return record.messageId;
    }

    yield* db
      .delete(messageIdempotency)
      .where(eq(messageIdempotency.id, record.id))
      .pipe(
        Effect.mapError(
          (cause) =>
            new MessageAcceptPersistenceError({
              cause,
              operation: "expire_idempotency",
              organizationId: input.organizationId,
            })
        )
      );
  });

export const recordMessageIdempotency = (
  db: DatabaseExecutor,
  input: RecordMessageIdempotencyInput
) =>
  Effect.gen(function* () {
    const [created] = yield* db
      .insert(messageIdempotency)
      .values({
        expiresAt: DateTime.toDate(DateTime.addDuration(input.now, "24 hours")),
        key: input.key,
        messageId: input.messageId,
        organizationId: input.organizationId,
      })
      .onConflictDoNothing({
        target: [messageIdempotency.organizationId, messageIdempotency.key],
      })
      .returning({ messageId: messageIdempotency.messageId })
      .pipe(
        Effect.mapError(
          (cause) =>
            new MessageAcceptPersistenceError({
              cause,
              messageId: input.messageId,
              operation: "record_idempotency",
              organizationId: input.organizationId,
            })
        )
      );

    if (created) {
      return { kind: "recorded" } satisfies RecordMessageIdempotencyResult;
    }

    const existing = yield* db.query.messageIdempotency
      .findFirst({
        columns: { messageId: true },
        where: {
          key: input.key,
          organizationId: input.organizationId,
        },
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new MessageAcceptPersistenceError({
              cause,
              operation: "find_idempotency",
              organizationId: input.organizationId,
            })
        )
      );
    if (!existing) {
      return yield* new MessageAcceptPersistenceError({
        cause: new Error(
          `Conflicting Idempotency record was not found for Organization ${input.organizationId}`
        ),
        messageId: input.messageId,
        operation: "find_idempotency",
        organizationId: input.organizationId,
      });
    }

    return {
      kind: "replay",
      messageId: existing.messageId,
    } satisfies RecordMessageIdempotencyResult;
  });
