import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import {
  contact,
  contactTopicUnsubscribe,
  type StrippedRecipient,
} from "@repo/persistence/db/schema";
import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import { type MessageContactInput, normalizeContactEmail } from "./accept/contacts";

export class MessageSuppressionLookupError extends Data.TaggedError(
  "MessageSuppressionLookupError",
)<{
  readonly cause: unknown;
  readonly organizationAppEnvironmentId: string;
  readonly organizationId: string;
}> {}

/**
 * The Contacts of one App Environment whose address is among `emails` (normalized). The column
 * is compared as stored: `contact_email_normalized_check` keeps every stored email normalized, so
 * a normalized address finds its Contact, through the unique index.
 */
export const contactsAmong = (input: {
  readonly emails: readonly string[];
  readonly organizationAppEnvironmentId: string;
}) =>
  and(
    eq(contact.organizationAppEnvironmentId, input.organizationAppEnvironmentId),
    inArray(contact.email, [...input.emails]),
  );

/** Whether a Contact's Suppression stops a send of this purpose. */
const suppressed = (purpose: "marketing" | "transactional") =>
  purpose === "marketing"
    ? isNotNull(contact.suppressionSeverity)
    : eq(contact.suppressionSeverity, "all");

/**
 * The Contacts of one App Environment, among `emails` (normalized), that a send of this
 * purpose must not go to. A Suppression stops it: severity `all` every send, `marketing` only
 * a marketing one. So does an Unsubscribe, for a marketing send alone: from all marketing, or
 * from the Message's Topic. One condition for the strip and for the Delivery's claim, so the
 * two cannot disagree.
 */
export const stoppedAmong = (input: {
  readonly emails: readonly string[];
  readonly organizationAppEnvironmentId: string;
  readonly purpose: "marketing" | "transactional";
  /** The Message's Topic. Read for a marketing send only. */
  readonly topicId: string | null;
}) =>
  and(
    contactsAmong(input),
    input.purpose === "marketing"
      ? or(
          suppressed(input.purpose),
          eq(contact.unsubscribed, true),
          input.topicId === null
            ? undefined
            : sql`exists (select 1 from ${contactTopicUnsubscribe}
                where ${contactTopicUnsubscribe.contactId} = ${contact.id}
                  and ${contactTopicUnsubscribe.topicId} = ${input.topicId})`,
        )
      : suppressed(input.purpose),
  );

export const filterStoppedRecipients = (
  db: DatabaseExecutor,
  input: {
    readonly organizationAppEnvironmentId: string;
    readonly organizationId: string;
    readonly purpose: "marketing" | "transactional";
    readonly recipients: readonly MessageContactInput[];
    readonly topicId: string | null;
  },
) =>
  Effect.gen(function* () {
    if (input.recipients.length === 0) {
      return {
        kept: [] as readonly MessageContactInput[],
        stripped: [] as readonly StrippedRecipient[],
      };
    }

    const normalized = input.recipients.map((recipient) => normalizeContactEmail(recipient.email));
    const rows = yield* db
      .select({
        email: contact.email,
        suppressed: sql<boolean>`${suppressed(input.purpose)} is true`,
      })
      .from(contact)
      .where(
        stoppedAmong({
          emails: normalized,
          organizationAppEnvironmentId: input.organizationAppEnvironmentId,
          purpose: input.purpose,
          topicId: input.topicId,
        }),
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new MessageSuppressionLookupError({
              cause,
              organizationAppEnvironmentId: input.organizationAppEnvironmentId,
              organizationId: input.organizationId,
            }),
        ),
      );

    // A Contact both suppressed and unsubscribed is reported as suppressed, the stricter.
    const stopped = new Map(
      rows.map((row) => [
        normalizeContactEmail(row.email),
        row.suppressed ? ("suppression" as const) : ("unsubscribed" as const),
      ]),
    );
    return {
      kept: input.recipients.filter(
        (recipient) => !stopped.has(normalizeContactEmail(recipient.email)),
      ),
      stripped: input.recipients.flatMap((recipient) => {
        const reason = stopped.get(normalizeContactEmail(recipient.email));
        return reason ? [{ email: recipient.email, reason }] : [];
      }),
    };
  });
