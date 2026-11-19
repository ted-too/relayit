import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import { contact } from "@repo/persistence/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
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
 * is lowered because not every stored email is lower-case, and a Suppression on such a Contact
 * must still be found; `contact_app_env_lower_email_idx` is on this expression, so write the
 * comparison nowhere else.
 */
export const contactsAmong = (input: {
  readonly emails: readonly string[];
  readonly organizationAppEnvironmentId: string;
}) =>
  and(
    eq(contact.organizationAppEnvironmentId, input.organizationAppEnvironmentId),
    inArray(sql`lower(${contact.email})`, [...input.emails]),
  );

/**
 * The Contacts of one App Environment, among `emails` (normalized), whose Suppression stops a
 * send of this purpose: severity `all` stops every send, `marketing` only a marketing one.
 * One condition for the strip and for the Delivery's claim, so the two cannot disagree.
 */
export const suppressedAmong = (input: {
  readonly emails: readonly string[];
  readonly organizationAppEnvironmentId: string;
  readonly purpose: "marketing" | "transactional";
}) =>
  and(
    contactsAmong(input),
    input.purpose === "marketing"
      ? isNotNull(contact.suppressionSeverity)
      : eq(contact.suppressionSeverity, "all"),
  );

export const filterSuppressedContacts = (
  db: DatabaseExecutor,
  input: {
    readonly organizationAppEnvironmentId: string;
    readonly organizationId: string;
    readonly purpose: "marketing" | "transactional";
    readonly recipients: readonly MessageContactInput[];
  },
) =>
  Effect.gen(function* () {
    if (input.recipients.length === 0) {
      return {
        kept: [] as readonly MessageContactInput[],
        stripped: [] as readonly MessageContactInput[],
      };
    }

    const normalized = input.recipients.map((recipient) => normalizeContactEmail(recipient.email));
    const rows = yield* db
      .select({ email: contact.email })
      .from(contact)
      .where(
        suppressedAmong({
          emails: normalized,
          organizationAppEnvironmentId: input.organizationAppEnvironmentId,
          purpose: input.purpose,
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

    const suppressed = new Set(rows.map((row) => normalizeContactEmail(row.email)));
    return {
      kept: input.recipients.filter(
        (recipient) => !suppressed.has(normalizeContactEmail(recipient.email)),
      ),
      stripped: input.recipients.filter((recipient) =>
        suppressed.has(normalizeContactEmail(recipient.email)),
      ),
    };
  });
