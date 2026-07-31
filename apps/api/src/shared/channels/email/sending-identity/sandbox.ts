import type { Provider, SandboxDomain } from "@repo/api/db";
import { db, schema } from "@repo/api/db";
import type { TaskContext } from "@repo/api/tasks";
import { createGenericError, logger } from "@repo/api/utils";
import { and, count, eq, isNull } from "drizzle-orm";
import type { DomainReadinessResult, EmailVendorOps } from "../types";
import {
  createDomainKeyMaterial,
  encryptDomainPrivateKey,
  loadDomainKeyMaterial,
  materializeSandboxDomainDns,
  registerProviderIdentity,
  teardownDomainIfNoIdentities,
  verifyProviderIdentity,
} from "./identity";

/**
 * Allocate an organization to a shared sandbox root using even distribution:
 * pick the active, verified, unpaused `sandboxDomain` with the fewest currently
 * allocated organizations and set `organization.sandboxDomainId` to it.
 *
 * Returns the chosen sandbox domain id, or `null` when no sandbox root is
 * available (in which case the org simply has no sandbox sender). Callers
 * should treat a thrown error / null as non-fatal — allocation must never block
 * organization creation.
 */
export async function allocateSandboxDomain(
  organizationId: string
): Promise<string | null> {
  const [picked] = await db
    .select({ id: schema.sandboxDomain.id })
    .from(schema.sandboxDomain)
    .leftJoin(
      schema.organization,
      eq(schema.organization.sandboxDomainId, schema.sandboxDomain.id)
    )
    .where(
      and(
        eq(schema.sandboxDomain.isActive, true),
        eq(schema.sandboxDomain.isPaused, false),
        eq(schema.sandboxDomain.verificationStatus, "verified")
      )
    )
    .groupBy(schema.sandboxDomain.id)
    .orderBy(count(schema.organization.id))
    .limit(1);

  if (!picked) {
    return null;
  }

  await db
    .update(schema.organization)
    .set({ sandboxDomainId: picked.id })
    .where(eq(schema.organization.id, organizationId));

  return picked.id;
}

/**
 * Allocate a sandbox root to every organization that currently has none,
 * least-loaded-first (each call to `allocateSandboxDomain` re-picks, so the
 * distribution stays balanced as we go). Best-effort and never throws: a
 * per-org failure is logged and skipped, and we stop early once no allocatable
 * sandbox root remains.
 *
 * Call this whenever a sandbox root becomes allocatable (newly verified,
 * activated, or unpaused) so orgs created while none existed get backfilled.
 * Returns the number of organizations newly assigned.
 */
async function assignSandboxDomainToUnassignedOrgs(): Promise<number> {
  const unassigned = await db
    .select({ id: schema.organization.id })
    .from(schema.organization)
    .where(isNull(schema.organization.sandboxDomainId));

  let assigned = 0;

  for (const org of unassigned) {
    try {
      const picked = await allocateSandboxDomain(org.id);

      if (!picked) {
        // No allocatable sandbox root available — nothing left to hand out.
        break;
      }

      assigned += 1;
    } catch (error) {
      logger.error(error, "Failed to allocate sandbox domain during sweep");
    }
  }

  return assigned;
}

/**
 * Run {@link assignSandboxDomainToUnassignedOrgs} only when the given sandbox
 * domain is actually allocatable (active, verified, not paused). Cheap guard for
 * the verify/activate code paths so we don't sweep on every verification poll.
 */
export async function sweepIfSandboxAllocatable(
  sandboxDomainId: string
): Promise<void> {
  const row = await db.query.sandboxDomain.findFirst({
    where: (table, { eq: equals }) => equals(table.id, sandboxDomainId),
    columns: { isActive: true, isPaused: true, verificationStatus: true },
  });

  if (row?.isActive && !row.isPaused && row.verificationStatus === "verified") {
    await assignSandboxDomainToUnassignedOrgs();
  }
}

export function createSandboxDomainOps(vendor: EmailVendorOps) {
  return {
    async create({
      params: { provider, rootDomain, cloudflareZoneId },
      ctx: { db: client },
    }: {
      params: {
        provider: Provider;
        rootDomain: string;
        cloudflareZoneId: string;
      };
      ctx: TaskContext;
    }) {
      const keyMaterial = createDomainKeyMaterial();
      const encryptedPrivateKey = await encryptDomainPrivateKey(
        keyMaterial.dkimPrivateKey
      );

      const sandboxDomainId = await client.transaction(async (tx) => {
        const [row] = await tx
          .insert(schema.sandboxDomain)
          .values({
            rootDomain,
            dkimSelector: keyMaterial.dkimSelector,
            dkimPublicKey: keyMaterial.dkimPublicKey,
            dkimPrivateKey: encryptedPrivateKey,
            cloudflareZoneId,
            verificationStatus: "not_verified",
            isActive: false,
            verifyBackoffLevel: 0,
          })
          .returning();

        await materializeSandboxDomainDns({
          client: tx,
          sandboxDomainId: row.id,
          fqdn: rootDomain,
          dkimSelector: keyMaterial.dkimSelector,
          dkimPublicKey: keyMaterial.dkimPublicKey,
          cloudflareZoneId,
        });

        await registerProviderIdentity({
          vendor,
          provider,
          fqdn: rootDomain,
          keyMaterial,
          type: "sandbox-domain",
          sandboxDomainId: row.id,
          db: tx,
        });

        return row.id;
      });

      return { sandboxDomainId };
    },

    async addProviderIdentity({
      params: { provider, sandboxDomain },
      ctx: { db: client },
    }: {
      params: { provider: Provider; sandboxDomain: SandboxDomain };
      ctx: TaskContext;
    }) {
      const keyMaterial = await loadDomainKeyMaterial(sandboxDomain);

      const identity = await registerProviderIdentity({
        vendor,
        provider,
        fqdn: sandboxDomain.rootDomain,
        keyMaterial,
        type: "sandbox-domain",
        sandboxDomainId: sandboxDomain.id,
        db: client,
      });

      return { identityId: identity.id };
    },

    async verify({
      params: { sandboxDomain },
      ctx: { db: client },
    }: {
      params: { sandboxDomain: SandboxDomain };
      ctx: TaskContext;
    }) {
      const identities =
        await client.query.emailDomainProviderIdentity.findMany({
          where: (table, { eq: equals }) =>
            equals(table.sandboxDomainId, sandboxDomain.id),
          with: { provider: true },
        });

      let lastResult: DomainReadinessResult | null = null;

      for (const identity of identities) {
        lastResult = await client.transaction((tx) =>
          verifyProviderIdentity({
            client: tx,
            vendor,
            provider: identity.provider,
            identity,
            fqdn: sandboxDomain.rootDomain,
            type: "sandbox-domain",
            sandboxDomainId: sandboxDomain.id,
          })
        );
      }

      if (!lastResult) {
        return {
          type: "sandbox-domain" as const,
          sandboxDomainId: sandboxDomain.id,
          verificationStatus: "not_verified" as const,
          nextCheckAt: null,
          activeRecords: 0,
          missingRecords: 0,
        };
      }

      return {
        ...lastResult,
        type: "sandbox-domain" as const,
        sandboxDomainId: sandboxDomain.id,
      };
    },

    async delete({
      params: { provider, sandboxDomain },
      ctx: { db: client },
    }: {
      params: { provider: Provider; sandboxDomain: SandboxDomain };
      ctx: TaskContext;
    }) {
      try {
        const identity =
          await client.query.emailDomainProviderIdentity.findFirst({
            where: (table, { eq: equals, and: combine }) =>
              combine(
                equals(table.sandboxDomainId, sandboxDomain.id),
                equals(table.providerId, provider.id)
              ),
          });

        if (!identity) {
          return { data: { deleted: false }, error: null };
        }

        await client.transaction(async (tx) => {
          await vendor.deleteIdentity({
            credentials: provider.credentials,
            fqdn: sandboxDomain.rootDomain,
          });

          await tx
            .delete(schema.emailDomainProviderIdentity)
            .where(eq(schema.emailDomainProviderIdentity.id, identity.id));

          await teardownDomainIfNoIdentities({
            db: tx,
            type: "sandbox-domain",
            sandboxDomain,
          });
        });

        return { data: { deleted: true as const }, error: null };
      } catch (error) {
        return {
          data: null,
          error: createGenericError(
            "Failed to delete sandbox domain identity",
            error as Error
          ),
        };
      }
    },
  };
}
