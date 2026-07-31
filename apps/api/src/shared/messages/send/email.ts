import { loadEmailAttachmentsForSend } from "@repo/api/channels/email/attachments";
import { filterSeverityAllRecipients } from "@repo/api/channels/email/deliverability/suppression";
import { providerCircuitBreaker } from "@repo/api/channels/email/providers/circuit";
import { listFailoverProviderIdentities } from "@repo/api/channels/email/sending-identity/router";
import type { RoutableProviderIdentity } from "@repo/api/channels/email/types";
import { type ProviderKind, schema } from "@repo/api/db";
import {
  emitWebhookEvent,
  resolveOrganizationIdForAppEnvironment,
} from "@repo/api/messages/webhooks";
import {
  RUNTIME_PROVIDER_REGISTRY,
  type RuntimeProviderType,
} from "@repo/api/providers/runtime";
import { QueueTerminalError, queue } from "@repo/api/queue";
import {
  consumeChannelSendQuota,
  resolveBillingPeriod,
  rollbackChannelSendQuota,
} from "@repo/api/tenancy/plans";
import { logger } from "@repo/api/utils";
import type { RedisClient } from "bun";
import { eq } from "drizzle-orm";
import * as z from "zod";

const deliveryPayload = z.object({
  deliveryId: z.string().min(1),
  /** Project Billing User — Usage confirm/release ledger (not necessarily Owner). */
  billingUserId: z.string().min(1),
  startDate: z.iso.datetime(),
  purpose: z.enum(["transactional", "marketing"]),
  providerKind: z.enum(["managed", "byo"]),
});

type DeliveryPayload = z.infer<typeof deliveryPayload>;

/** Tracks cross-kind remetering so terminal-fail releases the kind currently held. */
function deliveryReserveKindKey(deliveryId: string) {
  return `usage:email-delivery-reserve:${deliveryId}`;
}

function providerKindFor(provider: { scope: string }): ProviderKind {
  return provider.scope === "platform" ? "managed" : "byo";
}

async function readReservedProviderKind(
  redis: RedisClient,
  deliveryId: string,
  fallback: ProviderKind
): Promise<ProviderKind> {
  const stored = await redis.send("GET", [deliveryReserveKindKey(deliveryId)]);
  if (stored === "managed" || stored === "byo") {
    return stored;
  }
  return fallback;
}

async function writeReservedProviderKind(
  redis: RedisClient,
  deliveryId: string,
  kind: ProviderKind
) {
  await redis.send("SET", [
    deliveryReserveKindKey(deliveryId),
    kind,
    "EX",
    String(60 * 60 * 24),
  ]);
}

async function clearReservedProviderKind(
  redis: RedisClient,
  deliveryId: string
) {
  await redis.send("DEL", [deliveryReserveKindKey(deliveryId)]);
}

/**
 * Handoff queue for glossary-shaped email Deliveries (Message + email_delivery).
 * Soft-bounce retries are Provider-owned — no new Relayit Delivery.
 */
const delivery = queue({
  id: "email.send.delivery",
  payload: deliveryPayload,
  retry: {
    maxAttempts: 5,
    backoff: { baseMs: 30_000, maxMs: 15 * 60_000 },
  },
  async process(payload, ctx) {
    const emailDelivery = await ctx.db.query.emailDelivery.findFirst({
      where: (table, { eq: equals }) => equals(table.id, payload.deliveryId),
      with: {
        message: true,
        customDomain: {
          columns: { id: true, isPaused: true, verificationStatus: true },
        },
      },
    });

    if (!emailDelivery) {
      throw new QueueTerminalError(
        `Email Delivery ${payload.deliveryId} not found`
      );
    }

    if (emailDelivery.status === "sent") {
      logger.warn(
        { deliveryId: emailDelivery.id },
        "Email Delivery already sent, skipping duplicate handoff"
      );
      return;
    }

    if (
      emailDelivery.status === "skipped" ||
      emailDelivery.status === "canceled"
    ) {
      logger.warn(
        { deliveryId: emailDelivery.id, status: emailDelivery.status },
        "Email Delivery already terminal before handoff"
      );
      return;
    }

    if (emailDelivery.customDomain?.isPaused) {
      await ctx.db
        .update(schema.emailDelivery)
        .set({
          status: "failed",
          error: { message: "Domain is paused", retryable: false },
          completedAt: new Date(),
        })
        .where(eq(schema.emailDelivery.id, emailDelivery.id));
      throw new QueueTerminalError(
        `Email Delivery ${emailDelivery.id} failed: Domain paused`
      );
    }

    const appEnvironmentId = emailDelivery.message.organizationAppEnvironmentId;

    const toResult = await filterSeverityAllRecipients({
      db: ctx.db,
      organizationAppEnvironmentId: appEnvironmentId,
      recipients: emailDelivery.to.map((email) => ({ email })),
    });
    const ccResult = emailDelivery.cc
      ? await filterSeverityAllRecipients({
          db: ctx.db,
          organizationAppEnvironmentId: appEnvironmentId,
          recipients: emailDelivery.cc.map((email) => ({ email })),
        })
      : { kept: [] as { email: string }[] };
    const bccResult = emailDelivery.bcc
      ? await filterSeverityAllRecipients({
          db: ctx.db,
          organizationAppEnvironmentId: appEnvironmentId,
          recipients: emailDelivery.bcc.map((email) => ({ email })),
        })
      : { kept: [] as { email: string }[] };

    if (
      toResult.kept.length === 0 &&
      ccResult.kept.length === 0 &&
      bccResult.kept.length === 0
    ) {
      await ctx.db
        .update(schema.emailDelivery)
        .set({
          status: "skipped",
          error: {
            message: "All recipients suppressed at severity all",
            retryable: false,
            details: { reason: "suppression" },
          },
          completedAt: new Date(),
        })
        .where(eq(schema.emailDelivery.id, emailDelivery.id));

      const organizationId = await resolveOrganizationIdForAppEnvironment({
        db: ctx.db,
        organizationAppEnvironmentId: appEnvironmentId,
      });
      if (organizationId) {
        await emitWebhookEvent({
          db: ctx.db,
          redis: ctx.redis,
          organizationId,
          type: "delivery.skipped",
          messageTags: emailDelivery.message.tags,
          payload: {
            message_id: emailDelivery.messageId,
            delivery_id: emailDelivery.id,
            reason: "suppression",
          },
        });
      }

      throw new QueueTerminalError(
        `Email Delivery ${emailDelivery.id} skipped: no deliverable recipients`
      );
    }

    let identities: RoutableProviderIdentity[] = [];
    if (emailDelivery.customDomainId) {
      identities = await listFailoverProviderIdentities({
        db: ctx.db,
        type: "custom-domain",
        customDomainId: emailDelivery.customDomainId,
      });
    } else if (emailDelivery.sandboxDomainId) {
      identities = await listFailoverProviderIdentities({
        db: ctx.db,
        type: "sandbox-domain",
        sandboxDomainId: emailDelivery.sandboxDomainId,
      });
    } else {
      throw new QueueTerminalError(
        `Email Delivery ${emailDelivery.id} has no sender domain`
      );
    }

    if (identities.length === 0) {
      throw new QueueTerminalError(
        `No routable provider identity for email Delivery ${emailDelivery.id}`
      );
    }

    const breaker = providerCircuitBreaker.with(ctx.redis);
    const [primary, ...standby] = identities;

    const attachments = await loadEmailAttachmentsForSend({
      db: ctx.db,
      deliveryId: emailDelivery.id,
    });

    await ctx.db
      .update(schema.emailDelivery)
      .set({ status: "sending", startedAt: new Date() })
      .where(eq(schema.emailDelivery.id, emailDelivery.id));

    const date = new Date(payload.startDate);
    const period = await resolveBillingPeriod(payload.billingUserId, date);
    let reservedKind = await readReservedProviderKind(
      ctx.redis,
      payload.deliveryId,
      payload.providerKind
    );

    const channelLimits = await ctx.db.query.userChannel.findFirst({
      where: (table, { eq: equals, and: combine }) =>
        combine(
          equals(table.userId, payload.billingUserId),
          equals(table.channelType, "email")
        ),
    });

    if (!channelLimits) {
      throw new QueueTerminalError(
        `Channel limits not found for Billing User ${payload.billingUserId}`
      );
    }

    /**
     * Ensure Usage is held against `targetKind`. Cross-kind failover remeters
     * (consume new, then release old). Same-kind is a no-op.
     */
    const ensureReservedFor = async (
      targetKind: ProviderKind
    ): Promise<{ ok: true } | { ok: false; error: Error }> => {
      if (targetKind === reservedKind) {
        return { ok: true };
      }

      const exceeded = await consumeChannelSendQuota({
        channel: "email",
        purpose: payload.purpose,
        providerKind: targetKind,
        limits: channelLimits.limits,
        userId: payload.billingUserId,
        date,
        period,
        redis: ctx.redis,
      });

      if (exceeded) {
        return {
          ok: false,
          error: new Error(
            `Usage bucket exhausted for provider kind ${targetKind}: ${exceeded.message}`
          ),
        };
      }

      await rollbackChannelSendQuota({
        channel: "email",
        purpose: payload.purpose,
        providerKind: reservedKind,
        limits: channelLimits.limits,
        userId: payload.billingUserId,
        date,
        period,
        redis: ctx.redis,
      });

      reservedKind = targetKind;
      await writeReservedProviderKind(
        ctx.redis,
        payload.deliveryId,
        targetKind
      );
      return { ok: true };
    };

    const trySend = async (identity: RoutableProviderIdentity) => {
      const provider = identity.provider;
      const targetKind = providerKindFor(provider);

      const reserveResult = await ensureReservedFor(targetKind);
      if (!reserveResult.ok) {
        return {
          ok: false as const,
          leaveActive: true,
          error: reserveResult.error,
        };
      }

      const config =
        RUNTIME_PROVIDER_REGISTRY[provider.vendorId as RuntimeProviderType]
          ?.products?.[provider.productId];

      if (!config?.send) {
        return {
          ok: false as const,
          leaveActive: true,
          error: new Error(
            `Provider ${provider.vendorId}/${provider.productId} does not support sending`
          ),
        };
      }

      const sendResult = await config.send.raw({
        credentials: provider.credentials,
        message: {
          from: emailDelivery.from,
          to: toResult.kept,
          cc: ccResult.kept.length > 0 ? ccResult.kept : undefined,
          bcc: bccResult.kept.length > 0 ? bccResult.kept : undefined,
          reply_to: emailDelivery.replyTo ?? undefined,
          subject: emailDelivery.subject,
          html: emailDelivery.html ?? undefined,
          text: emailDelivery.text ?? undefined,
          headers: emailDelivery.headers ?? undefined,
          attachments: attachments.length > 0 ? attachments : undefined,
        },
      });

      if (sendResult.error) {
        await breaker.recordFailure({ providerId: provider.id });
        const circuitOpen = !(await breaker.allow({
          providerId: provider.id,
        }));
        return {
          ok: false as const,
          leaveActive: circuitOpen,
          error: new Error(sendResult.error.message),
        };
      }

      await breaker.recordSuccess({ providerId: provider.id });
      // Provider accept → Delivery sent. Reserve sticks (implicit confirm).
      await clearReservedProviderKind(ctx.redis, payload.deliveryId);
      await ctx.db
        .update(schema.emailDelivery)
        .set({
          status: "sent",
          providerId: provider.id,
          providerMessageId: sendResult.data.messageId,
          completedAt: new Date(),
        })
        .where(eq(schema.emailDelivery.id, emailDelivery.id));

      const organizationId = await resolveOrganizationIdForAppEnvironment({
        db: ctx.db,
        organizationAppEnvironmentId: appEnvironmentId,
      });
      if (organizationId) {
        await emitWebhookEvent({
          db: ctx.db,
          redis: ctx.redis,
          organizationId,
          type: "message.sent",
          messageTags: emailDelivery.message.tags,
          payload: {
            message_id: emailDelivery.messageId,
            delivery_id: emailDelivery.id,
            provider_message_id: sendResult.data.messageId,
          },
        });
      }

      return { ok: true as const };
    };

    if (primary && (await breaker.allow({ providerId: primary.provider.id }))) {
      const primaryResult = await trySend(primary);
      if (primaryResult.ok) {
        return;
      }
      // Stay on active for queue backoff unless circuit opened (leave active).
      if (!primaryResult.leaveActive) {
        throw primaryResult.error;
      }
    }

    let lastError: Error | null = null;
    for (const identity of standby) {
      if (!(await breaker.allow({ providerId: identity.provider.id }))) {
        continue;
      }
      const result = await trySend(identity);
      if (result.ok) {
        return;
      }
      lastError = result.error;
    }

    await ctx.db
      .update(schema.emailDelivery)
      .set({
        status: "failed",
        error: {
          message: lastError?.message ?? "All providers failed",
          retryable: true,
        },
        completedAt: new Date(),
      })
      .where(eq(schema.emailDelivery.id, emailDelivery.id));

    const organizationId = await resolveOrganizationIdForAppEnvironment({
      db: ctx.db,
      organizationAppEnvironmentId: appEnvironmentId,
    });
    if (organizationId) {
      await emitWebhookEvent({
        db: ctx.db,
        redis: ctx.redis,
        organizationId,
        type: "message.failed",
        messageTags: emailDelivery.message.tags,
        payload: {
          message_id: emailDelivery.messageId,
          delivery_id: emailDelivery.id,
          error: lastError?.message ?? "All providers failed",
        },
      });
    }

    throw new Error(
      `Failed to send email Delivery ${emailDelivery.id}: ${lastError?.message ?? "all providers failed"}`
    );
  },
  hooks: {
    async onTerminalFail({ payload, ctx }) {
      const channelLimits = await ctx.db.query.userChannel.findFirst({
        where: (table, { eq: equals, and: combine }) =>
          combine(
            equals(table.userId, payload.billingUserId),
            equals(table.channelType, "email")
          ),
      });

      if (!channelLimits) {
        logger.error(
          { payload },
          "Channel limits not found on delivery terminal fail"
        );
        return;
      }

      const date = new Date(payload.startDate);
      const period = await resolveBillingPeriod(payload.billingUserId, date);
      const providerKind = await readReservedProviderKind(
        ctx.redis,
        payload.deliveryId,
        payload.providerKind
      );

      await rollbackChannelSendQuota({
        channel: "email",
        purpose: payload.purpose,
        providerKind,
        limits: channelLimits.limits,
        userId: payload.billingUserId,
        date,
        period,
        redis: ctx.redis,
      });

      await clearReservedProviderKind(ctx.redis, payload.deliveryId);
    },
  },
});

export const emailSendQueue = {
  delivery,
};

export type { DeliveryPayload };
