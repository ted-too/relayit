import { schema } from "@repo/api/db";
import {
  RUNTIME_PROVIDER_REGISTRY,
  type RuntimeProviderType,
} from "@repo/api/providers/runtime";
import { task } from "@repo/api/tasks";

import { eq, isNotNull } from "drizzle-orm";
import * as z from "zod";
import { detectDnsProvider } from "../dns";

export const verifyDomainTask = task({
  id: "email.verify-domain",
  payload: z.object({ customDomainId: z.string().min(1) }),
  redis: {
    member: (p) => [p.customDomainId],
  },
  async process({ customDomainId }, { redis, db }) {
    const customDomain = await db.query.customDomain.findFirst({
      where: (table, { eq }) => eq(table.id, customDomainId),
      with: {
        providerIdentities: {
          with: { provider: true },
        },
      },
    });

    if (!customDomain) {
      return;
    }

    const firstIdentity = customDomain.providerIdentities[0];
    if (!firstIdentity) {
      return;
    }

    const config =
      RUNTIME_PROVIDER_REGISTRY[
        firstIdentity.provider.vendorId as RuntimeProviderType
      ].products?.[firstIdentity.provider.productId];

    if (!config?.customDomain) {
      return;
    }

    const result = await config.customDomain.checkReadiness({
      params: { customDomain },
      ctx: { redis, db },
    });

    const detectedProvider = await detectDnsProvider(customDomain.fqdn);
    if (detectedProvider !== customDomain.provider) {
      await db
        .update(schema.customDomain)
        .set({ provider: detectedProvider })
        .where(eq(schema.customDomain.id, customDomain.id));
    }

    if (result.nextCheckAt) {
      await verifyDomainTask
        .with(redis)
        .schedule({ customDomainId: customDomain.id }, result.nextCheckAt);
    } else {
      await verifyDomainTask
        .with(redis)
        .unschedule({ customDomainId: customDomain.id });
    }
  },
  async reconcile({ redis, db }) {
    const customDomains = await db
      .select({
        id: schema.customDomain.id,
        nextVerifyAt: schema.customDomain.nextVerifyAt,
      })
      .from(schema.customDomain)
      .where(isNotNull(schema.customDomain.nextVerifyAt));

    for (const customDomain of customDomains) {
      if (customDomain.nextVerifyAt) {
        await verifyDomainTask
          .with(redis)
          .schedule(
            { customDomainId: customDomain.id },
            customDomain.nextVerifyAt
          );
      }
    }
  },
});
