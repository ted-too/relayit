import { db, schema } from "@repo/api/db";
import { IS_CLOUD_EDITION } from "@repo/api/env";
import { ensureUserLimits } from "@repo/api/tenancy/plans";
import { provisionProjectEmailChannel } from "@repo/api/tenancy/project-email";
import { stripeClient } from "@repo/api/tenancy/stripe";
import { logger } from "@repo/api/utils";
import { and, eq, isNull } from "drizzle-orm";

/**
 * Ensure the user has a Stripe customer, mirroring the stripe plugin's
 * `createCustomerOnSignUp` for users that predate it. Idempotent: it no-ops once
 * `user.stripeCustomerId` is set, reuses an existing Stripe customer with the
 * same email when one exists (so retries don't create duplicates), and only
 * writes the id back when it's still null.
 */
async function ensureStripeCustomer(userId: string): Promise<void> {
  const user = await db.query.user.findFirst({
    where: (table, { eq: equals }) => equals(table.id, userId),
    columns: { id: true, email: true, name: true, stripeCustomerId: true },
  });

  if (!user || user.stripeCustomerId) {
    return;
  }

  const existing = await stripeClient.customers.list({
    email: user.email,
    limit: 1,
  });

  const customer =
    existing.data[0] ??
    (await stripeClient.customers.create({
      email: user.email,
      name: user.name,
      metadata: { userId: user.id },
    }));

  await db
    .update(schema.user)
    .set({ stripeCustomerId: customer.id })
    .where(
      and(eq(schema.user.id, user.id), isNull(schema.user.stripeCustomerId))
    );
}

/**
 * Idempotently bring a user up to their current (free-by-default) plan: it
 * materializes the plan caps the send path reads (`user.limit*` and a
 * `user_channel` row per channel via {@link ensureUserLimits}) and, on the cloud
 * edition, allocates a sandbox root to any org they belong to that lacks one.
 *
 * This is the self-healing net invoked from the auth sign-in/sign-up after-hook,
 * so existing users — and any user that predates a provisioning step — get
 * backfilled on their next authenticated session. It never throws: provisioning
 * must never block authentication.
 */
export async function ensureUserProvisioned(userId: string): Promise<void> {
  try {
    await ensureUserLimits(userId);
  } catch (error) {
    logger.error(error, "Failed to sync user limits during provisioning");
  }

  if (!IS_CLOUD_EDITION) {
    return;
  }

  try {
    await ensureStripeCustomer(userId);
  } catch (error) {
    logger.error(error, "Failed to ensure stripe customer during provisioning");
  }

  let memberOrgs: { id: string }[] = [];

  try {
    memberOrgs = await db
      .select({ id: schema.organization.id })
      .from(schema.organization)
      .innerJoin(
        schema.member,
        eq(schema.member.organizationId, schema.organization.id)
      )
      .where(
        and(
          eq(schema.member.userId, userId),
          isNull(schema.organization.sandboxDomainId)
        )
      );
  } catch (error) {
    logger.error(error, "Failed to load orgs needing email provision");
    return;
  }

  for (const org of memberOrgs) {
    try {
      await provisionProjectEmailChannel(org.id);
    } catch (error) {
      logger.error(
        error,
        "Failed to provision Project email channel during backfill"
      );
    }
  }
}
