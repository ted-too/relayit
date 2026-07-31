import { schema } from "@repo/api/db";
import {
  RUNTIME_PROVIDER_REGISTRY,
  type RuntimeProviderType,
} from "@repo/api/providers/runtime";
import { task } from "@repo/api/tasks";

import { eq } from "drizzle-orm";
import * as z from "zod";

export const verifyProviderTask = task({
  id: "email.verify-provider",
  payload: z.object({ providerId: z.string().min(1) }),
  redis: {
    member: (p) => [p.providerId],
  },
  async process({ providerId }, { redis, db }) {
    const provider = await db.query.provider.findFirst({
      where: (table, { eq }) => eq(table.id, providerId),
    });

    if (!provider) {
      return;
    }

    const config =
      RUNTIME_PROVIDER_REGISTRY[provider.vendorId as RuntimeProviderType]
        .products?.[provider.productId];

    if (!config?.provider) {
      return;
    }

    const { nextCheckAt } = await config.provider.refreshSharedDns({
      ctx: { redis, db },
    });

    if (nextCheckAt) {
      await verifyProviderTask
        .with(redis)
        .schedule({ providerId: provider.id }, nextCheckAt);
    }
  },
  async reconcile({ redis, db }) {
    const providers = await db
      .select({ id: schema.provider.id })
      .from(schema.provider)
      .where(eq(schema.provider.channelType, "email"));

    for (const provider of providers) {
      await verifyProviderTask
        .with(redis)
        .schedule({ providerId: provider.id }, new Date());
    }
  },
});
