import type { CustomDomain, SandboxDomain } from "@repo/api/db";
import { type DbOrTx, schema } from "@repo/api/db";
import { and, eq, sql } from "drizzle-orm";

/**
 * Fixed local part every org sends from on a shared sandbox root (e.g.
 * `sandbox@relayit.fyi`). We verify the root domain, not per-org addresses, so
 * the local part is a platform constant rather than a stored column.
 */
export const SANDBOX_FROM_LOCAL_PART = "sandbox";

export type ResolvedEmailSender =
  | { kind: "custom"; customDomainId: CustomDomain["id"] }
  | { kind: "sandbox"; sandboxDomainId: SandboxDomain["id"] };

/**
 * Resolve which sending domain an outbound email should use from its `from`
 * address, gating on the org actually being allowed to send from it.
 *
 * Two sender kinds are possible:
 *   - **sandbox**: the org's allocated shared root. The from address must be
 *     exactly `${SANDBOX_FROM_LOCAL_PART}@${rootDomain}` (e.g.
 *     `sandbox@relayit.fyi`) and the root must be active, verified, and not
 *     paused.
 *   - **custom**: a user-owned domain linked to the org via `organizationDomain`.
 *     The from address domain must equal the `customDomain.fqdn` (exact match),
 *     and the domain must be verified and not paused. (No per-Project ownership
 *     TXT on the normal send path — see Email CONTEXT Domain.)
 *
 * Returns `null` when the from address doesn't map to a sendable domain for the
 * organization — callers surface this as an `invalid_from_address` error.
 */
export async function resolveEmailSender({
  db,
  organizationId,
  fromAddress,
}: {
  db: DbOrTx;
  organizationId: string;
  fromAddress: string;
}): Promise<ResolvedEmailSender | null> {
  const normalizedFrom = fromAddress.trim().toLowerCase();
  const fromDomain = normalizedFrom.split("@")[1];

  if (!fromDomain) {
    return null;
  }

  // Sandbox: the org's allocated shared root, sent from exactly
  // `${SANDBOX_FROM_LOCAL_PART}@${rootDomain}`.
  const org = await db.query.organization.findFirst({
    where: (table, { eq: eqOrg }) => eqOrg(table.id, organizationId),
    columns: { id: true },
    with: {
      sandboxDomain: {
        columns: {
          id: true,
          rootDomain: true,
          verificationStatus: true,
          isActive: true,
          isPaused: true,
        },
      },
    },
  });

  const sandbox = org?.sandboxDomain;
  if (sandbox) {
    const sandboxFrom =
      `${SANDBOX_FROM_LOCAL_PART}@${sandbox.rootDomain}`.toLowerCase();

    if (
      normalizedFrom === sandboxFrom &&
      sandbox.isActive &&
      !sandbox.isPaused &&
      sandbox.verificationStatus === "verified"
    ) {
      return { kind: "sandbox", sandboxDomainId: sandbox.id };
    }
  }

  // Custom: a Project-linked Domain. Gated on verified + not paused (and a link
  // row so the FQDN belongs to this Project).
  const [customLink] = await db
    .select({ customDomainId: schema.customDomain.id })
    .from(schema.organizationDomain)
    .innerJoin(
      schema.customDomain,
      eq(schema.organizationDomain.customDomainId, schema.customDomain.id)
    )
    .where(
      and(
        eq(schema.organizationDomain.organizationId, organizationId),
        eq(sql`lower(${schema.customDomain.fqdn})`, fromDomain),
        eq(schema.customDomain.verificationStatus, "verified"),
        eq(schema.customDomain.isPaused, false)
      )
    )
    .limit(1);

  if (customLink) {
    return { kind: "custom", customDomainId: customLink.customDomainId };
  }

  return null;
}
