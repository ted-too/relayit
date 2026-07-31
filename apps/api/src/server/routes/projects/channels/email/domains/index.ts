import { SANDBOX_FROM_LOCAL_PART } from "@repo/api/channels/email/sender";
import { DomainClaimError } from "@repo/api/channels/email/sending-identity/custom-domain";
import {
  ownershipChallengeHost,
  ownershipChallengeValue,
} from "@repo/api/channels/email/sending-identity/dns";
import { verifyDomainTask } from "@repo/api/channels/email/sending-identity/tasks/verify-domain";
import { verifyOwnershipTask } from "@repo/api/channels/email/sending-identity/tasks/verify-ownership";
import { verifyProviderIdentityTask } from "@repo/api/channels/email/sending-identity/tasks/verify-provider-identity";
import { db, type Provider, schema } from "@repo/api/db";
import {
  RUNTIME_PROVIDER_REGISTRY,
  type RuntimeProviderType,
} from "@repo/api/providers/runtime";
import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import { apiRedis } from "@repo/api/server/lib/redis";
import {
  loadBillingUserEmailLimits,
  resolveBillingUserId,
} from "@repo/api/tenancy/billing-user";
import { isByoProvidersAllowed } from "@repo/api/tenancy/entitlements";
import { resolveDefaultManagedEmailProviderId } from "@repo/api/tenancy/project-email";
import {
  addDomainProviderBodySchema,
  createDomainBodySchema,
  domainIdParamsSchema,
  domainProviderParamsSchema,
  pauseDomainBodySchema,
  switchActiveProviderBodySchema,
  updateFailoverBodySchema,
} from "@repo/api/validators/routes/projects/channels/email/domains";
import { and, eq } from "drizzle-orm";
import { Elysia, status } from "elysia";

async function assertByoAllowed(organizationId: string) {
  const billingUserId = await resolveBillingUserId(organizationId);
  if (!billingUserId) {
    return status(500, "Billing User not found for this Project");
  }

  const limits = await loadBillingUserEmailLimits(billingUserId);
  if (!limits) {
    return status(500, "Billing User channel limits not found");
  }

  if (!isByoProvidersAllowed(limits)) {
    return status(
      403,
      "Your plan does not allow bringing your own email Provider"
    );
  }

  return null;
}

async function resolveEmailProvider({
  organizationId,
  providerId,
}: {
  organizationId: string;
  providerId?: string;
}) {
  if (providerId) {
    const provider = await db.query.provider.findFirst({
      where: (table, { eq: equals, and: combine, or }) =>
        combine(
          equals(table.id, providerId),
          equals(table.channelType, "email"),
          or(
            equals(table.scope, "platform"),
            combine(
              equals(table.scope, "project"),
              equals(table.organizationId, organizationId)
            )
          )
        ),
    });

    if (!provider) {
      return {
        provider: null as Provider | null,
        error: status(404, "Provider not found"),
      };
    }

    if (provider.scope === "project") {
      const denied = await assertByoAllowed(organizationId);
      if (denied) {
        return { provider: null as Provider | null, error: denied };
      }
    }

    return { provider, error: null };
  }

  const managedEmailProviderId = await resolveDefaultManagedEmailProviderId();
  if (!managedEmailProviderId) {
    return {
      provider: null as Provider | null,
      error: status(400, "No default managed email Provider is configured"),
    };
  }

  const provider = await db.query.provider.findFirst({
    where: (table, { eq: equals, and: combine }) =>
      combine(
        equals(table.id, managedEmailProviderId),
        equals(table.scope, "platform"),
        equals(table.channelType, "email")
      ),
  });

  if (!provider) {
    return {
      provider: null as Provider | null,
      error: status(404, "Managed email Provider not found"),
    };
  }

  return { provider, error: null };
}

function customDomainConfig(provider: Provider) {
  return RUNTIME_PROVIDER_REGISTRY?.[provider.vendorId as RuntimeProviderType]
    ?.products?.[provider.productId];
}

function ownershipStatusForLink(link: {
  ownershipVerificationStatus: string;
  ownershipEverVerifiedAt: Date | null;
}) {
  if (link.ownershipVerificationStatus === "verified") {
    return "active" as const;
  }
  if (link.ownershipEverVerifiedAt) {
    return "missing" as const;
  }
  return "pending" as const;
}

function isPendingClaim(link: {
  ownershipVerificationStatus: string;
  pendingProviderId: string | null;
}) {
  return (
    link.ownershipVerificationStatus !== "verified" ||
    link.pendingProviderId != null
  );
}

/** Purposes shown in the DKIM/SPF DNS table (send-path auth records). */
const DKIM_SPF_DNS_PURPOSES = new Set([
  "dkim",
  "spf",
  "mail_from_mx",
  "mail_from_spf",
]);

async function listProjectDomains({
  customDomainId,
  organizationId,
}: {
  customDomainId?: string;
  organizationId: string;
}) {
  const links = await db.query.organizationDomain.findMany({
    where: (table, { eq: equals, and: combine }) =>
      combine(
        equals(table.organizationId, organizationId),
        customDomainId
          ? equals(table.customDomainId, customDomainId)
          : undefined
      ),
    with: {
      customDomain: {
        columns: {
          id: true,
          fqdn: true,
          provider: true,
          verificationStatus: true,
          createdAt: true,
          isPaused: true,
          pausedReason: true,
          lastCheckedAt: true,
        },
        with: {
          dnsRecords: {
            where: (table, { eq: equals }) => equals(table.role, "direct"),
            orderBy: (table, { sql }) => sql`${table.priority} asc nulls last`,
            columns: {
              purpose: true,
              name: true,
              value: true,
              recordType: true,
              status: true,
              priority: true,
              lastCheckedAt: true,
            },
          },
          providerIdentities: {
            columns: {
              id: true,
              providerId: true,
              verificationStatus: true,
              isActive: true,
              failoverEligible: true,
              failoverPriority: true,
            },
            orderBy: (table, { asc }) => [asc(table.failoverPriority)],
          },
        },
      },
    },
  });

  return links.map(({ customDomain, ...link }) => {
    const pendingClaim = isPendingClaim(link);
    const ownershipStatus = ownershipStatusForLink(link);
    const ownershipTxt = pendingClaim
      ? {
          purpose: "ownership" as const,
          recordType: "TXT" as const,
          name: ownershipChallengeHost(customDomain.fqdn),
          value: ownershipChallengeValue(link.ownershipToken),
          status: ownershipStatus,
          lastCheckedAt: link.ownershipLastCheckedAt,
          priority: null,
        }
      : null;

    const dkimAndSpf = customDomain.dnsRecords.filter((record) =>
      DKIM_SPF_DNS_PURPOSES.has(record.purpose)
    );
    const dmarc = customDomain.dnsRecords.filter(
      (record) => record.purpose === "dmarc"
    );

    return {
      ...customDomain,
      dnsRecords: {
        dkimAndSpf,
        ownership: ownershipTxt ? [ownershipTxt] : [],
        dmarc,
      },
      providerIdentities: customDomain.providerIdentities,
      ownership: {
        status: ownershipStatus,
        pendingProviderId: link.pendingProviderId,
      },
    };
  });
}

function loadOrgDomainLink({
  organizationId,
  domainId,
}: {
  organizationId: string;
  domainId: string;
}) {
  return db.query.organizationDomain.findFirst({
    where: (table, { eq: equals, and: combine }) =>
      combine(
        equals(table.organizationId, organizationId),
        equals(table.customDomainId, domainId)
      ),
    with: {
      customDomain: {
        with: {
          providerIdentities: {
            with: { provider: true },
          },
        },
      },
    },
  });
}

export const domainsRoutes = new Elysia({ prefix: "/domains" })
  .use(betterAuthOrganization)
  .guard({
    organization: true,
    auth: true,
  })
  .get("/", async ({ organization, request }) => {
    const hasPermission = await auth.api.hasPermission({
      headers: request.headers,
      body: {
        organizationId: organization.id,
        permissions: {
          integration: ["read"],
        },
      },
    });

    if (!hasPermission) {
      return status(403, "You do not have permission to read domains");
    }

    return listProjectDomains({
      organizationId: organization.id,
    });
  })
  .get("/sandbox", async ({ organization, request }) => {
    const hasPermission = await auth.api.hasPermission({
      headers: request.headers,
      body: {
        organizationId: organization.id,
        permissions: {
          integration: ["read"],
        },
      },
    });

    if (!hasPermission) {
      return status(403, "You do not have permission to read domains");
    }

    const org = await db.query.organization.findFirst({
      where: (table, { eq: equals }) => equals(table.id, organization.id),
      columns: {
        sandboxDomainId: true,
      },
      with: {
        sandboxDomain: {
          columns: {
            rootDomain: true,
            verificationStatus: true,
            isPaused: true,
          },
        },
      },
    });

    if (!org?.sandboxDomain) {
      return { allocated: false as const };
    }

    const { sandboxDomain } = org;

    return {
      allocated: true as const,
      fromAddress: `${SANDBOX_FROM_LOCAL_PART}@${sandboxDomain.rootDomain}`,
      rootDomain: sandboxDomain.rootDomain,
      verificationStatus: sandboxDomain.verificationStatus,
      isPaused: sandboxDomain.isPaused,
    };
  })
  .post(
    "/",
    async ({ body, organization, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: {
            integration: ["create"],
          },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to create domains");
      }

      const billingUserId = await resolveBillingUserId(organization.id);
      if (!billingUserId) {
        return status(500, "Billing User not found for this Project");
      }

      const limits = await loadBillingUserEmailLimits(billingUserId);
      if (!limits) {
        return status(500, "Billing User channel limits not found");
      }

      const existingCustomDomains = await db.query.organizationDomain.findMany({
        where: (table, { eq: equals }) =>
          equals(table.organizationId, organization.id),
        columns: {
          customDomainId: true,
        },
      });

      if (
        limits.customDomains !== null &&
        existingCustomDomains.length >= limits.customDomains
      ) {
        return status(
          400,
          "You have reached the maximum number of custom domains"
        );
      }

      const resolved = await resolveEmailProvider({
        organizationId: organization.id,
        providerId: body.providerId,
      });
      if (resolved.error) {
        return resolved.error;
      }

      const { provider } = resolved;
      const config = customDomainConfig(provider);

      if (!config?.customDomain) {
        return status(400, "Provider does not support domain setup");
      }

      let customDomainId: string;
      try {
        ({ customDomainId } = await config.customDomain.create({
          params: {
            provider,
            organizationId: organization.id,
            fqdn: body.fqdn,
          },
          ctx: { db, redis: apiRedis },
        }));
      } catch (error) {
        if (error instanceof DomainClaimError) {
          return status(409, error.message);
        }
        throw error;
      }

      await verifyDomainTask.with(apiRedis).enqueue({ customDomainId });

      const link = await db.query.organizationDomain.findFirst({
        where: (table, { eq: equals, and: combine }) =>
          combine(
            equals(table.organizationId, organization.id),
            equals(table.customDomainId, customDomainId)
          ),
      });

      if (link && isPendingClaim(link)) {
        await verifyOwnershipTask.with(apiRedis).enqueue({
          organizationId: organization.id,
          customDomainId,
        });
      }

      const [newDomain] = await listProjectDomains({
        organizationId: organization.id,
        customDomainId,
      });

      if (!newDomain) {
        return status(500, "New domain not found after creation");
      }

      return newDomain;
    },
    {
      body: createDomainBodySchema,
    }
  )
  .post(
    "/:domainId/verify",
    async ({ organization, params: { domainId }, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: {
            integration: ["create"],
          },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to verify domains");
      }

      const link = await loadOrgDomainLink({
        organizationId: organization.id,
        domainId,
      });

      if (!link) {
        return status(404, "Domain not found for this Project");
      }

      const firstIdentity = link.customDomain.providerIdentities[0];
      if (!firstIdentity) {
        return status(400, "Domain has no Provider pairings");
      }

      const config = customDomainConfig(firstIdentity.provider);
      if (!config?.customDomain) {
        return status(400, "Provider does not support domain verification");
      }

      await config.customDomain.checkReadiness({
        params: {
          customDomain: link.customDomain,
        },
        ctx: { db, redis: apiRedis },
      });

      if (isPendingClaim(link)) {
        await config.customDomain.checkOwnership({
          params: {
            customDomain: link.customDomain,
            organizationId: organization.id,
          },
          ctx: { db, redis: apiRedis },
        });
      }

      const [updatedDomain] = await listProjectDomains({
        organizationId: organization.id,
        customDomainId: domainId,
      });

      if (!updatedDomain) {
        return status(500, "Updated domain not found after verification");
      }

      return updatedDomain;
    },
    {
      params: domainIdParamsSchema,
    }
  )
  .post(
    "/:domainId/providers",
    async ({ organization, params: { domainId }, body, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: {
            integration: ["create"],
          },
        },
      });

      if (!hasPermission) {
        return status(
          403,
          "You do not have permission to manage domain Provider pairings"
        );
      }

      const link = await loadOrgDomainLink({
        organizationId: organization.id,
        domainId,
      });

      if (!link) {
        return status(404, "Domain not found for this Project");
      }

      const resolved = await resolveEmailProvider({
        organizationId: organization.id,
        providerId: body.providerId,
      });
      if (resolved.error) {
        return resolved.error;
      }

      const { provider } = resolved;
      const config = customDomainConfig(provider);

      if (!config?.customDomain) {
        return status(400, "Provider does not support domain setup");
      }

      const { identityId } = await config.customDomain.addProviderIdentity({
        params: { provider, customDomain: link.customDomain },
        ctx: { db, redis: apiRedis },
      });

      await verifyProviderIdentityTask.with(apiRedis).enqueue({ identityId });
      await verifyDomainTask
        .with(apiRedis)
        .enqueue({ customDomainId: domainId });

      const [updatedDomain] = await listProjectDomains({
        organizationId: organization.id,
        customDomainId: domainId,
      });

      if (!updatedDomain) {
        return status(500, "Updated domain not found after attaching Provider");
      }

      return updatedDomain;
    },
    {
      params: domainIdParamsSchema,
      body: addDomainProviderBodySchema,
    }
  )
  .delete(
    "/:domainId/providers/:providerId",
    async ({ organization, params: { domainId, providerId }, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: {
            integration: ["delete"],
          },
        },
      });

      if (!hasPermission) {
        return status(
          403,
          "You do not have permission to manage domain Provider pairings"
        );
      }

      const link = await loadOrgDomainLink({
        organizationId: organization.id,
        domainId,
      });

      if (!link) {
        return status(404, "Domain not found for this Project");
      }

      const identity = link.customDomain.providerIdentities.find(
        (row) => row.providerId === providerId
      );

      if (!identity) {
        return status(404, "Provider pairing not found for this Domain");
      }

      if (identity.isActive) {
        return status(
          400,
          "Cannot remove the active Provider pairing; switch active first"
        );
      }

      const config = customDomainConfig(identity.provider);
      if (!config?.customDomain) {
        return status(400, "Provider does not support domain setup");
      }

      await config.customDomain.removeProviderIdentity({
        params: {
          provider: identity.provider,
          customDomain: link.customDomain,
        },
        ctx: { db, redis: apiRedis },
      });

      const [updatedDomain] = await listProjectDomains({
        organizationId: organization.id,
        customDomainId: domainId,
      });

      if (!updatedDomain) {
        return status(500, "Updated domain not found after removing Provider");
      }

      return updatedDomain;
    },
    {
      params: domainProviderParamsSchema,
    }
  )
  .post(
    "/:domainId/activeProvider",
    async ({ organization, params: { domainId }, body, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: {
            integration: ["update"],
          },
        },
      });

      if (!hasPermission) {
        return status(
          403,
          "You do not have permission to update domain Provider pairings"
        );
      }

      const link = await loadOrgDomainLink({
        organizationId: organization.id,
        domainId,
      });

      if (!link) {
        return status(404, "Domain not found for this Project");
      }

      const identity = link.customDomain.providerIdentities.find(
        (row) => row.providerId === body.providerId
      );

      if (!identity) {
        return status(404, "Provider pairing not found for this Domain");
      }

      if (identity.verificationStatus !== "verified") {
        return status(
          400,
          "Provider pairing must be verified before it can become active"
        );
      }

      await db.transaction(async (tx) => {
        await tx
          .update(schema.emailDomainProviderIdentity)
          .set({ isActive: false })
          .where(
            eq(schema.emailDomainProviderIdentity.customDomainId, domainId)
          );

        await tx
          .update(schema.emailDomainProviderIdentity)
          .set({ isActive: true })
          .where(
            and(
              eq(schema.emailDomainProviderIdentity.customDomainId, domainId),
              eq(schema.emailDomainProviderIdentity.providerId, body.providerId)
            )
          );
      });

      const [updatedDomain] = await listProjectDomains({
        organizationId: organization.id,
        customDomainId: domainId,
      });

      if (!updatedDomain) {
        return status(
          500,
          "Updated domain not found after switching active Provider"
        );
      }

      return updatedDomain;
    },
    {
      params: domainIdParamsSchema,
      body: switchActiveProviderBodySchema,
    }
  )
  .patch(
    "/:domainId/providers/:providerId",
    async ({
      organization,
      params: { domainId, providerId },
      body,
      request,
    }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: {
            integration: ["update"],
          },
        },
      });

      if (!hasPermission) {
        return status(
          403,
          "You do not have permission to update domain Provider pairings"
        );
      }

      const link = await loadOrgDomainLink({
        organizationId: organization.id,
        domainId,
      });

      if (!link) {
        return status(404, "Domain not found for this Project");
      }

      const identity = link.customDomain.providerIdentities.find(
        (row) => row.providerId === providerId
      );

      if (!identity) {
        return status(404, "Provider pairing not found for this Domain");
      }

      await db
        .update(schema.emailDomainProviderIdentity)
        .set({
          ...(body.failoverEligible === undefined
            ? {}
            : { failoverEligible: body.failoverEligible }),
          ...(body.failoverPriority === undefined
            ? {}
            : { failoverPriority: body.failoverPriority }),
        })
        .where(eq(schema.emailDomainProviderIdentity.id, identity.id));

      const [updatedDomain] = await listProjectDomains({
        organizationId: organization.id,
        customDomainId: domainId,
      });

      if (!updatedDomain) {
        return status(500, "Updated domain not found after updating failover");
      }

      return updatedDomain;
    },
    {
      params: domainProviderParamsSchema,
      body: updateFailoverBodySchema,
    }
  )
  .post(
    "/:domainId/pause",
    async ({ organization, params: { domainId }, body, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: {
            integration: ["update"],
          },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to pause domains");
      }

      const link = await loadOrgDomainLink({
        organizationId: organization.id,
        domainId,
      });

      if (!link) {
        return status(404, "Domain not found for this Project");
      }

      await db
        .update(schema.customDomain)
        .set({
          isPaused: true,
          pausedReason: body.reason,
        })
        .where(eq(schema.customDomain.id, domainId));

      const [updatedDomain] = await listProjectDomains({
        organizationId: organization.id,
        customDomainId: domainId,
      });

      if (!updatedDomain) {
        return status(500, "Updated domain not found after pause");
      }

      return updatedDomain;
    },
    {
      params: domainIdParamsSchema,
      body: pauseDomainBodySchema,
    }
  )
  .post(
    "/:domainId/unpause",
    async ({ organization, params: { domainId }, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: {
            integration: ["update"],
          },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to unpause domains");
      }

      const link = await loadOrgDomainLink({
        organizationId: organization.id,
        domainId,
      });

      if (!link) {
        return status(404, "Domain not found for this Project");
      }

      await db
        .update(schema.customDomain)
        .set({
          isPaused: false,
          pausedReason: null,
        })
        .where(eq(schema.customDomain.id, domainId));

      const [updatedDomain] = await listProjectDomains({
        organizationId: organization.id,
        customDomainId: domainId,
      });

      if (!updatedDomain) {
        return status(500, "Updated domain not found after unpause");
      }

      return updatedDomain;
    },
    {
      params: domainIdParamsSchema,
    }
  )
  .delete(
    "/:domainId",
    async ({ organization, params: { domainId }, request }) => {
      const hasPermission = await auth.api.hasPermission({
        headers: request.headers,
        body: {
          organizationId: organization.id,
          permissions: {
            integration: ["delete"],
          },
        },
      });

      if (!hasPermission) {
        return status(403, "You do not have permission to delete domains");
      }

      const link = await loadOrgDomainLink({
        organizationId: organization.id,
        domainId,
      });

      if (!link) {
        return status(404, "Domain not found for this Project");
      }

      const firstIdentity = link.customDomain.providerIdentities[0];
      if (!firstIdentity) {
        return status(400, "Domain has no Provider pairings");
      }

      const config = customDomainConfig(firstIdentity.provider);
      if (!config?.customDomain) {
        return status(400, "Provider does not support domain deletion");
      }

      const result = await config.customDomain.delete({
        params: {
          provider: firstIdentity.provider,
          customDomain: link.customDomain,
          organizationId: organization.id,
        },
        ctx: { db, redis: apiRedis },
      });

      if (result.error) {
        return status(400, result.error.message);
      }

      return result.data;
    },
    {
      params: domainIdParamsSchema,
    }
  );
