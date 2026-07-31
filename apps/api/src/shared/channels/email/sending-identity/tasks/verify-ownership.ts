import { schema } from "@repo/api/db";
import {
  RUNTIME_PROVIDER_REGISTRY,
  type RuntimeProviderType,
} from "@repo/api/providers/runtime";
import { task } from "@repo/api/tasks";
import { eq, isNotNull } from "drizzle-orm";
import * as z from "zod";

export const verifyOwnershipTask = task({
  id: "email.verify-ownership",
  payload: z.object({
    organizationId: z.string().min(1),
    customDomainId: z.string().min(1),
  }),
  redis: {
    member: (p) => [p.organizationId, p.customDomainId],
  },
  async process({ organizationId, customDomainId }, { redis, db }) {
    const customDomain = await db.query.customDomain.findFirst({
      where: (table, { eq }) => eq(table.id, customDomainId),
    });

    if (!customDomain) {
      return;
    }

    const firstIdentity = await db.query.emailDomainProviderIdentity.findFirst({
      where: (table, { eq }) => eq(table.customDomainId, customDomainId),
      with: { provider: true },
    });

    if (!firstIdentity) {
      return;
    }

    const productConfig =
      RUNTIME_PROVIDER_REGISTRY[
        firstIdentity.provider.vendorId as RuntimeProviderType
      ].products?.[firstIdentity.provider.productId];

    if (!productConfig) {
      return;
    }

    const result = await productConfig.customDomain.checkOwnership({
      params: { customDomain, organizationId },
      ctx: { redis, db },
    });

    if (result.nextCheckAt) {
      await verifyOwnershipTask
        .with(redis)
        .schedule({ organizationId, customDomainId }, result.nextCheckAt);
    } else {
      await verifyOwnershipTask
        .with(redis)
        .unschedule({ organizationId, customDomainId });
    }
  },
  async reconcile({ redis, db }) {
    const links = await db
      .select({
        organizationId: schema.organizationDomain.organizationId,
        customDomainId: schema.organizationDomain.customDomainId,
        ownershipNextVerifyAt: schema.organizationDomain.ownershipNextVerifyAt,
      })
      .from(schema.organizationDomain)
      .innerJoin(
        schema.customDomain,
        eq(schema.organizationDomain.customDomainId, schema.customDomain.id)
      )
      .where(isNotNull(schema.organizationDomain.ownershipNextVerifyAt));

    for (const link of links) {
      if (link.ownershipNextVerifyAt) {
        await verifyOwnershipTask.with(redis).schedule(
          {
            organizationId: link.organizationId,
            customDomainId: link.customDomainId,
          },
          link.ownershipNextVerifyAt
        );
      }
    }
  },
});
