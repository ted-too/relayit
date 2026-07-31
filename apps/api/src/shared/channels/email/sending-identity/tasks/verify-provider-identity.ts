import { schema } from "@repo/api/db";
import {
  RUNTIME_PROVIDER_REGISTRY,
  type RuntimeProviderType,
} from "@repo/api/providers/runtime";
import { task } from "@repo/api/tasks";

import { isNotNull } from "drizzle-orm";
import * as z from "zod";

export const verifyProviderIdentityTask = task({
  id: "email.verify-provider-identity",
  payload: z.object({ identityId: z.string().min(1) }),
  redis: {
    member: (p) => [p.identityId],
  },
  async process({ identityId }, { redis, db }) {
    const identity = await db.query.emailDomainProviderIdentity.findFirst({
      where: (table, { eq }) => eq(table.id, identityId),
      with: {
        provider: true,
        customDomain: true,
        sandboxDomain: true,
      },
    });

    if (!identity) {
      return;
    }

    const config =
      RUNTIME_PROVIDER_REGISTRY[
        identity.provider.vendorId as RuntimeProviderType
      ].products?.[identity.provider.productId];

    if (!config) {
      return;
    }

    if (identity.customDomain) {
      await config.customDomain.checkReadiness({
        params: { customDomain: identity.customDomain },
        ctx: { redis, db },
      });
    } else if (identity.sandboxDomain) {
      await config.sandboxDomain.verify({
        params: { sandboxDomain: identity.sandboxDomain },
        ctx: { redis, db },
      });
    }

    const refreshed = await db.query.emailDomainProviderIdentity.findFirst({
      where: (table, { eq }) => eq(table.id, identityId),
    });

    if (refreshed?.nextVerifyAt) {
      await verifyProviderIdentityTask
        .with(redis)
        .schedule({ identityId }, refreshed.nextVerifyAt);
    } else {
      await verifyProviderIdentityTask.with(redis).unschedule({ identityId });
    }
  },
  async reconcile({ redis, db }) {
    const rows = await db
      .select({
        id: schema.emailDomainProviderIdentity.id,
        nextVerifyAt: schema.emailDomainProviderIdentity.nextVerifyAt,
      })
      .from(schema.emailDomainProviderIdentity)
      .where(isNotNull(schema.emailDomainProviderIdentity.nextVerifyAt));

    for (const row of rows) {
      if (row.nextVerifyAt) {
        await verifyProviderIdentityTask
          .with(redis)
          .schedule({ identityId: row.id }, row.nextVerifyAt);
      }
    }
  },
});
