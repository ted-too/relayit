import { type DB, schema, type Transaction } from "@repo/shared/db";
import type { ChannelType, Recipient } from "@repo/shared/providers";
import { eq } from "drizzle-orm";
import { HTTPException } from "hono/http-exception";

interface FindOrCreateContactOptions {
  dbOrTx: DB | Transaction;
  organizationId: string;
  identifier: string;
  channel: ChannelType;
  contactData?: Recipient;
}

// Three-tier contact resolution: identifier → external IDs → create new
export async function findOrCreateContact({
  dbOrTx,
  organizationId,
  identifier,
  channel,
  contactData,
}: FindOrCreateContactOptions) {
  const existingContactIdentifier =
    await dbOrTx.query.contactIdentifier.findFirst({
      where: (table, { eq, and }) =>
        and(eq(table.channel, channel), eq(table.identifier, identifier)),
      with: {
        contact: true,
      },
    });

  if (existingContactIdentifier) {
    if (contactData?.name || contactData?.externalIdentifiers) {
      const updates: Partial<{
        name: string;
        externalIdentifiers: Record<string, string[]>;
      }> = {};

      if (contactData.name) {
        updates.name = contactData.name;
      }

      if (contactData.externalIdentifiers) {
        const existingExtIds =
          existingContactIdentifier.contact.externalIdentifiers || {};
        const mergedExtIds = { ...existingExtIds };

        for (const [key, value] of Object.entries(
          contactData.externalIdentifiers
        )) {
          if (mergedExtIds[key]) {
            if (!mergedExtIds[key].includes(value)) {
              mergedExtIds[key].push(value);
            }
          } else {
            mergedExtIds[key] = [value];
          }
        }

        updates.externalIdentifiers = mergedExtIds;
      }

      if (Object.keys(updates).length > 0) {
        await dbOrTx
          .update(schema.contact)
          .set(updates)
          .where(eq(schema.contact.id, existingContactIdentifier.contact.id));

        return {
          ...existingContactIdentifier.contact,
          ...updates,
        };
      }
    }

    return existingContactIdentifier.contact;
  }

  if (
    contactData?.externalIdentifiers &&
    Object.keys(contactData.externalIdentifiers).length > 0
  ) {
    // PostgreSQL JSONB operator: ?| checks if any keys exist
    const extIdKeys = Object.keys(contactData.externalIdentifiers);
    const existingContact = await dbOrTx.query.contact.findFirst({
      where: (table, { eq, and, sql }) =>
        and(
          eq(table.organizationId, organizationId),
          sql`${table.externalIdentifiers} ?| array[${extIdKeys.map((key) => `'${key}'`).join(",")}]`
        ),
    });

    if (existingContact) {
      const updates: Partial<{
        name: string;
        externalIdentifiers: Record<string, string[]>;
      }> = {};

      if (contactData.name) {
        updates.name = contactData.name;
      }

      const existingExtIds = existingContact.externalIdentifiers || {};
      const mergedExtIds = { ...existingExtIds };

      for (const [key, value] of Object.entries(
        contactData.externalIdentifiers
      )) {
        if (mergedExtIds[key]) {
          if (!mergedExtIds[key].includes(value)) {
            mergedExtIds[key].push(value);
          }
        } else {
          mergedExtIds[key] = [value];
        }
      }

      updates.externalIdentifiers = mergedExtIds;

      if (Object.keys(updates).length > 0) {
        await dbOrTx
          .update(schema.contact)
          .set(updates)
          .where(eq(schema.contact.id, existingContact.id));
      }

      await dbOrTx.insert(schema.contactIdentifier).values({
        contactId: existingContact.id,
        channel,
        identifier,
        isPrimary: true,
      });

      return {
        ...existingContact,
        ...updates,
      };
    }
  }

  // Convert Record<string, string> to Record<string, string[]>
  const externalIdentifiersArray: Record<string, string[]> = {};
  if (contactData?.externalIdentifiers) {
    for (const [key, value] of Object.entries(
      contactData.externalIdentifiers
    )) {
      externalIdentifiersArray[key] = [value];
    }
  }

  const [newContact] = await dbOrTx
    .insert(schema.contact)
    .values({
      organizationId,
      name: contactData?.name,
      externalIdentifiers: externalIdentifiersArray,
    })
    .returning();

  await dbOrTx.insert(schema.contactIdentifier).values({
    contactId: newContact.id,
    channel,
    identifier,
    isPrimary: true,
  });

  return newContact;
}

interface FindProviderIdentityOptions {
  dbOrTx: DB | Transaction;
  organizationId: string;
  channel: ChannelType;
  fromIdentifier?: string;
}

// Provider selection with identity fallback across all active providers
export async function findProviderIdentity({
  dbOrTx,
  organizationId,
  channel,
  fromIdentifier,
}: FindProviderIdentityOptions) {
  const allProviders = await dbOrTx.query.providerCredential.findMany({
    where: (table, { eq, and, inArray }) =>
      and(
        eq(table.organizationId, organizationId),
        eq(table.channelType, channel),
        eq(table.isActive, true),
        inArray(
          table.id,
          dbOrTx
            .select({ id: schema.providerIdentity.providerCredentialId })
            .from(schema.providerIdentity)
            .where(eq(schema.providerIdentity.isActive, true))
        )
      ),
    with: {
      identities: true,
    },
    orderBy: (table, { desc, asc }) => [
      desc(table.isDefault),
      asc(table.priority),
    ],
  });

  const bestProvider = allProviders[0];

  if (!bestProvider) {
    throw new HTTPException(400, {
      message: `No active provider found for channel: ${channel}`,
    });
  }

  if (!bestProvider.identities || bestProvider.identities.length === 0) {
    throw new HTTPException(400, {
      message: `No active identities found for provider: ${bestProvider.name}`,
    });
  }

  if (fromIdentifier) {
    let specificIdentity = bestProvider.identities.find(
      (identity) => identity.identifier === fromIdentifier
    );

    // Fallback: search across all providers
    if (!specificIdentity) {
      specificIdentity = allProviders
        .flatMap((provider) => provider.identities)
        .find((identity) => identity.identifier === fromIdentifier);
    }

    if (!specificIdentity) {
      throw new HTTPException(400, {
        message: `From identity '${fromIdentifier}' not found in provider: ${bestProvider.name}`,
      });
    }

    return specificIdentity;
  }

  let defaultIdentity = bestProvider.identities.find(
    (identity) => identity.isDefault
  );

  if (!defaultIdentity) {
    defaultIdentity = allProviders
      .flatMap((provider) => provider.identities)
      .find((identity) => identity.isDefault);
  }

  if (!defaultIdentity) {
    throw new HTTPException(400, {
      message: `No default identity found for provider: ${bestProvider.name}`,
    });
  }

  return defaultIdentity;
}

interface FindActiveTemplateOptions {
  dbOrTx: DB | Transaction;
  organizationId: string;
  templateSlug: string;
  channel: ChannelType;
}

// Find active template with current version and channel content
export async function findActiveTemplate({
  dbOrTx,
  organizationId,
  templateSlug,
  channel,
}: FindActiveTemplateOptions) {
  const template = await dbOrTx.query.template.findFirst({
    where: (table, { eq, and }) =>
      and(
        eq(table.organizationId, organizationId),
        eq(table.slug, templateSlug),
        eq(table.status, "active")
      ),
    with: {
      currentVersion: {
        with: {
          channelVersions: true,
        },
      },
    },
  });

  if (!template) {
    throw new HTTPException(404, {
      message: `Template '${templateSlug}' not found or not active`,
    });
  }

  if (!template.currentVersion) {
    throw new HTTPException(400, {
      message: `Template '${templateSlug}' has no current version`,
    });
  }

  // Filter channel versions after fetching
  const channelVersion = template.currentVersion.channelVersions.find(
    (cv) => cv.channel === channel
  );

  if (!channelVersion) {
    throw new HTTPException(400, {
      message: `Template '${templateSlug}' has no content for channel '${channel}'`,
    });
  }

  return {
    template,
    templateVersion: template.currentVersion,
    channelVersion,
  };
}
