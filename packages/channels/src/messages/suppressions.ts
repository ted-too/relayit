import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import { contact } from "@repo/persistence/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";
import { Data, Effect } from "effect";
import {
  type MessageContactInput,
  normalizeContactEmail,
} from "./accept/contacts";

export class MessageSuppressionLookupError extends Data.TaggedError(
  "MessageSuppressionLookupError"
)<{
  readonly cause: unknown;
  readonly organizationAppEnvironmentId: string;
  readonly organizationId: string;
}> {}

export const filterSuppressedContacts = (
  db: DatabaseExecutor,
  input: {
    readonly organizationAppEnvironmentId: string;
    readonly organizationId: string;
    readonly recipients: readonly MessageContactInput[];
  }
) =>
  Effect.gen(function* () {
    if (input.recipients.length === 0) {
      return {
        kept: [] as readonly MessageContactInput[],
        stripped: [] as readonly MessageContactInput[],
      };
    }

    const normalized = input.recipients.map((recipient) =>
      normalizeContactEmail(recipient.email)
    );
    const rows = yield* db
      .select({ email: contact.email })
      .from(contact)
      .where(
        and(
          eq(
            contact.organizationAppEnvironmentId,
            input.organizationAppEnvironmentId
          ),
          eq(contact.suppressionSeverity, "all"),
          inArray(sql`lower(${contact.email})`, normalized)
        )
      )
      .pipe(
        Effect.mapError(
          (cause) =>
            new MessageSuppressionLookupError({
              cause,
              organizationAppEnvironmentId: input.organizationAppEnvironmentId,
              organizationId: input.organizationId,
            })
        )
      );

    const suppressed = new Set(
      rows.map((row) => normalizeContactEmail(row.email))
    );
    return {
      kept: input.recipients.filter(
        (recipient) => !suppressed.has(normalizeContactEmail(recipient.email))
      ),
      stripped: input.recipients.filter((recipient) =>
        suppressed.has(normalizeContactEmail(recipient.email))
      ),
    };
  });
