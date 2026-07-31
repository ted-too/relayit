import type { DbOrTx } from "@repo/api/db";
import type { DomainReadinessType, RoutableProviderIdentity } from "../types";
import { listRoutableIdentities } from "./identity";

/**
 * Order routable identities for a send: active Provider first, then other
 * verified + failover-eligible pairings in Project-defined priority order.
 * Caller fails over on circuit-open / terminal provider errors only.
 */
export async function listFailoverProviderIdentities({
  db,
  ...domain
}: { db: DbOrTx } & DomainReadinessType): Promise<RoutableProviderIdentity[]> {
  const identities = await listRoutableIdentities({ db, ...domain });

  const active = identities.find((identity) => identity.isActive);
  const failover = identities
    .filter(
      (identity) =>
        !identity.isActive &&
        identity.failoverEligible &&
        identity.verificationStatus === "verified"
    )
    .sort((a, b) => a.failoverPriority - b.failoverPriority);

  if (!active) {
    return failover;
  }

  return [active, ...failover.filter((identity) => identity.id !== active.id)];
}
