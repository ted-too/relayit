import { db, type EmailLimits, schema } from "@repo/api/db";
import { eq } from "drizzle-orm";
import { emailLimitsForEdition } from "./entitlements";

/**
 * Resolve the Billing User for a Project.
 * Prefers `organization.billingUserId`; falls back to the Owner member.
 */
export async function resolveBillingUserId(
  organizationId: string
): Promise<string | null> {
  const organization = await db.query.organization.findFirst({
    where: (table, { eq: equals }) => equals(table.id, organizationId),
    columns: { billingUserId: true },
  });

  if (organization?.billingUserId) {
    return organization.billingUserId;
  }

  const owner = await db.query.member.findFirst({
    where: (table, { eq: equals, and }) =>
      and(
        equals(table.organizationId, organizationId),
        equals(table.role, "owner")
      ),
    columns: { userId: true },
  });

  return owner?.userId ?? null;
}

/** True when `userId` is the Project's resolved Billing User. */
export async function isBillingUser(
  organizationId: string,
  userId: string
): Promise<boolean> {
  const billingUserId = await resolveBillingUserId(organizationId);
  return billingUserId === userId;
}

/**
 * Set the Project Billing User. Caller must validate membership and permissions.
 */
export async function setBillingUserId(
  organizationId: string,
  billingUserId: string
) {
  const [updated] = await db
    .update(schema.organization)
    .set({ billingUserId })
    .where(eq(schema.organization.id, organizationId))
    .returning({
      id: schema.organization.id,
      billingUserId: schema.organization.billingUserId,
    });

  return updated;
}

/** Email Plan limits for a Billing User, with self-hosted unlimited overlay. */
export async function loadBillingUserEmailLimits(
  billingUserId: string
): Promise<EmailLimits | null> {
  const channelRow = await db.query.userChannel.findFirst({
    where: (table, { eq: equals, and }) =>
      and(
        equals(table.userId, billingUserId),
        equals(table.channelType, "email")
      ),
  });

  if (!channelRow) {
    return null;
  }

  return emailLimitsForEdition(channelRow.limits as EmailLimits);
}
