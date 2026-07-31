import type { ChannelType } from "@repo/api/db";
import { type ContactIdentifier, type DbOrTx, schema } from "@repo/api/db";
import type { ContactProperties } from "@repo/api/validators";
import { sql } from "drizzle-orm";

/** Trim + lowercase for Contact primary-email uniqueness. */
export function normalizeContactEmail(email: string): string {
  return email.trim().toLowerCase();
}

function normalizeIdentifier<T extends ChannelType>(
  identifier: ContactIdentifier<T>
): ContactIdentifier<T> {
  if ("email" in identifier) {
    return {
      ...identifier,
      email: normalizeContactEmail(identifier.email),
    };
  }
  return identifier;
}

/**
 * Atomically find-or-update a contact for an app environment.
 *
 * Uses a single `INSERT … ON CONFLICT DO UPDATE` keyed on the
 * `(organizationAppEnvironmentId, email)` unique index, so concurrent sends to
 * the same recipient can't race into a unique-violation or duplicate rows the
 * way a read-then-write would. On conflict we keep existing name fields unless
 * the new send supplies them, shallow-merge `properties` (new keys win), and
 * clear `deletedAt` so an upsert revives a soft-deleted Contact without
 * clearing Suppression / Unsubscribe.
 *
 * The caller passes an already-resolved `organizationAppEnvironmentId` so this
 * stays a single statement. Run sequentially on a shared transaction — node-pg
 * does not allow concurrent queries on one connection.
 */
export async function findOrUpsertContact<T extends ChannelType>({
  db,
  organizationAppEnvironmentId,
  channel: _channel,
  identifier,
  data,
}: {
  db: DbOrTx;
  organizationAppEnvironmentId: string;
  identifier: ContactIdentifier<T>;
  data?: {
    firstName?: string;
    lastName?: string;
    properties?: ContactProperties;
  };
  channel: T;
}) {
  const normalized = normalizeIdentifier(identifier);

  const [contact] = await db
    .insert(schema.contact)
    .values({
      organizationAppEnvironmentId,
      ...normalized,
      firstName: data?.firstName,
      lastName: data?.lastName,
      properties: data?.properties,
    })
    .onConflictDoUpdate({
      target: [
        schema.contact.organizationAppEnvironmentId,
        schema.contact.email,
      ],
      set: {
        firstName: sql`coalesce(excluded.first_name, ${schema.contact.firstName})`,
        lastName: sql`coalesce(excluded.last_name, ${schema.contact.lastName})`,
        properties: sql`
          case
            when excluded.properties is null then ${schema.contact.properties}
            when ${schema.contact.properties} is null then excluded.properties
            else ${schema.contact.properties} || excluded.properties
          end
        `,
        deletedAt: null,
        updatedAt: new Date(),
      },
    })
    .returning();

  return contact;
}
