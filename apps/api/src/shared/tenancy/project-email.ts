import { allocateSandboxDomain } from "@repo/api/channels/email/sending-identity/sandbox";
import { db } from "@repo/api/db";

/** Resolve the current ops default managed email backend (or oldest platform fallback). */
export async function resolveDefaultManagedEmailProviderId(): Promise<
  string | null
> {
  const defaults = await db.query.provider.findFirst({
    where: (table, { eq: equals, and: combine }) =>
      combine(
        equals(table.scope, "platform"),
        equals(table.channelType, "email"),
        equals(table.isDefault, true)
      ),
    columns: { id: true },
  });

  if (defaults) {
    return defaults.id;
  }

  const any = await db.query.provider.findFirst({
    where: (table, { eq: equals, and: combine }) =>
      combine(
        equals(table.scope, "platform"),
        equals(table.channelType, "email")
      ),
    columns: { id: true },
    orderBy: (table, { asc }) => [asc(table.createdAt)],
  });

  return any?.id ?? null;
}

/** Allocate Sandbox Domain for a Project when missing. Idempotent. */
export async function provisionProjectEmailChannel(
  organizationId: string
): Promise<void> {
  const org = await db.query.organization.findFirst({
    where: (table, { eq: equals }) => equals(table.id, organizationId),
    columns: {
      id: true,
      sandboxDomainId: true,
    },
  });

  if (!org || org.sandboxDomainId) {
    return;
  }

  await allocateSandboxDomain(organizationId);
}
