import { sweepIfSandboxAllocatable } from "@repo/api/channels/email/sending-identity/sandbox";
import { schema } from "@repo/api/db";
import {
  RUNTIME_PROVIDER_REGISTRY,
  type RuntimeProviderType,
} from "@repo/api/providers/runtime";
import { task } from "@repo/api/tasks";
import { isNotNull } from "drizzle-orm";
import * as z from "zod";
import { verifyProviderIdentityTask } from "./verify-provider-identity";

export const verifySandboxDomainTask = task({
  id: "email.verify-sandbox-domain",
  payload: z.object({ sandboxDomainId: z.string().min(1) }),
  redis: {
    member: (p) => [p.sandboxDomainId],
  },
  async process({ sandboxDomainId }, { redis, db }) {
    const sandboxDomain = await db.query.sandboxDomain.findFirst({
      where: (table, { eq }) => eq(table.id, sandboxDomainId),
      with: {
        providerIdentities: {
          with: { provider: true },
        },
      },
    });

    if (!sandboxDomain) {
      return;
    }

    const firstIdentity = sandboxDomain.providerIdentities[0];
    if (!firstIdentity) {
      return;
    }

    const config =
      RUNTIME_PROVIDER_REGISTRY[
        firstIdentity.provider.vendorId as RuntimeProviderType
      ].products?.[firstIdentity.provider.productId];

    if (!config?.sandboxDomain) {
      return;
    }

    const result = await config.sandboxDomain.verify({
      params: { sandboxDomain },
      ctx: { redis, db },
    });

    await sweepIfSandboxAllocatable(sandboxDomainId);

    for (const identity of sandboxDomain.providerIdentities) {
      await verifyProviderIdentityTask.with(redis).enqueue({
        identityId: identity.id,
      });
    }

    if (result.nextCheckAt) {
      await verifySandboxDomainTask
        .with(redis)
        .schedule({ sandboxDomainId }, result.nextCheckAt);
    } else {
      await verifySandboxDomainTask.with(redis).unschedule({ sandboxDomainId });
    }
  },
  async reconcile({ redis, db }) {
    const rows = await db
      .select({
        id: schema.sandboxDomain.id,
        nextVerifyAt: schema.sandboxDomain.nextVerifyAt,
      })
      .from(schema.sandboxDomain)
      .where(isNotNull(schema.sandboxDomain.nextVerifyAt));

    for (const row of rows) {
      if (row.nextVerifyAt) {
        await verifySandboxDomainTask
          .with(redis)
          .schedule({ sandboxDomainId: row.id }, row.nextVerifyAt);
      }
    }
  },
});
