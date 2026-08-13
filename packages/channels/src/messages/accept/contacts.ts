import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import { contact } from "@repo/persistence/db/schema";
import { sql } from "drizzle-orm";
import { DateTime, Effect } from "effect";
import { MessageAcceptPersistenceError } from "./errors";

export interface MessageContactInput {
  readonly email: string;
  readonly firstName?: string;
  readonly lastName?: string;
  readonly properties?: Readonly<Record<string, string>>;
}

export interface UpsertMessageContactsInput {
  readonly contacts: readonly MessageContactInput[];
  readonly now: DateTime.Utc;
  readonly organizationAppEnvironmentId: string;
}

export const normalizeContactEmail = (email: string): string =>
  email.trim().toLowerCase();

export const mergeMessageContacts = (
  contacts: readonly MessageContactInput[]
): readonly MessageContactInput[] => {
  const byEmail = new Map<string, MessageContactInput>();

  for (const candidate of contacts) {
    const email = normalizeContactEmail(candidate.email);
    const existing = byEmail.get(email);
    if (!existing) {
      byEmail.set(email, { ...candidate, email });
      continue;
    }

    const properties = {
      ...candidate.properties,
      ...existing.properties,
    };
    byEmail.set(email, {
      email,
      ...((existing.firstName ?? candidate.firstName)
        ? { firstName: existing.firstName ?? candidate.firstName }
        : {}),
      ...((existing.lastName ?? candidate.lastName)
        ? { lastName: existing.lastName ?? candidate.lastName }
        : {}),
      ...(Object.keys(properties).length > 0 ? { properties } : {}),
    });
  }

  return [...byEmail.values()];
};

export const upsertMessageContacts = (
  db: DatabaseExecutor,
  input: UpsertMessageContactsInput
) =>
  Effect.forEach(
    mergeMessageContacts(input.contacts),
    (candidate) =>
      db
        .insert(contact)
        .values({
          email: candidate.email,
          firstName: candidate.firstName,
          lastName: candidate.lastName,
          organizationAppEnvironmentId: input.organizationAppEnvironmentId,
          properties: candidate.properties,
        })
        .onConflictDoUpdate({
          target: [contact.organizationAppEnvironmentId, contact.email],
          set: {
            deletedAt: null,
            firstName: sql`coalesce(excluded.first_name, ${contact.firstName})`,
            lastName: sql`coalesce(excluded.last_name, ${contact.lastName})`,
            properties: sql`
              case
                when excluded.properties is null then ${contact.properties}
                when ${contact.properties} is null then excluded.properties
                else ${contact.properties} || excluded.properties
              end
            `,
            updatedAt: DateTime.toDate(input.now),
          },
        })
        .returning({
          email: contact.email,
          id: contact.id,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new MessageAcceptPersistenceError({
                cause,
                operation: "upsert_contact",
                organizationAppEnvironmentId:
                  input.organizationAppEnvironmentId,
              })
          ),
          Effect.flatMap(([record]) =>
            record
              ? Effect.succeed(record)
              : Effect.die(
                  new Error(
                    `Contact upsert returned no record for App Environment ${input.organizationAppEnvironmentId}`
                  )
                )
          )
        ),
    { concurrency: 1 }
  );
