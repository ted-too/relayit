import { ingestDmarcReportEmail } from "@repo/api/channels/email/deliverability/dmarc";
import { ingestDeliveryEvents } from "@repo/api/channels/email/deliverability/notifications";
import type { EmailWebhookOps } from "@repo/api/channels/email/types";
import { unsubscribeInboundDomain } from "@repo/api/channels/email/unsubscribe";
import { ingestUnsubscribeInbound } from "@repo/api/contacts/unsubscribe";
import { db } from "@repo/api/db";
import {
  RUNTIME_PROVIDER_REGISTRY,
  type RuntimeProviderType,
} from "@repo/api/providers/runtime";
import { apiRedis } from "@repo/api/server/lib/redis";
import { logger } from "@repo/api/utils";
import { Elysia, status } from "elysia";

const UNSUBSCRIBE_DOMAIN_SUFFIX = `@${unsubscribeInboundDomain}`;

function isUnsubscribeInbound(recipients: string[]) {
  return recipients.some((recipient) =>
    recipient.trim().toLowerCase().endsWith(UNSUBSCRIBE_DOMAIN_SUFFIX)
  );
}

/**
 * Provider notification ingress — SES SNS (and peers) push delivery / inbound
 * signals here. Not a Project Webhook Endpoint; not customer inbound-as-product.
 */
export const providerWebhookRoutes = new Elysia({
  prefix: "/webhooks/providers",
}).post("/:vendorId/:productId", async ({ params, request }) => {
  const product =
    RUNTIME_PROVIDER_REGISTRY[params.vendorId as RuntimeProviderType]
      ?.products?.[params.productId];

  const webhooks = (product as { webhooks?: EmailWebhookOps } | undefined)
    ?.webhooks;

  if (!webhooks) {
    return status(404, "Webhook handler not found");
  }

  const rawBody = await request.text();

  try {
    const result = await webhooks.handle({
      rawBody,
      headers: request.headers,
    });

    if (result.type === "events") {
      await ingestDeliveryEvents({
        db,
        redis: apiRedis,
        events: result.events,
      });
    } else if (result.type === "inbound") {
      if (isUnsubscribeInbound(result.recipients)) {
        await ingestUnsubscribeInbound({
          db,
          recipients: result.recipients,
        });
      } else {
        await ingestDmarcReportEmail({ db, email: result.email });
      }
    }

    return status(200, { ok: true });
  } catch (error) {
    logger.error(
      { error, vendorId: params.vendorId, productId: params.productId },
      "Provider webhook handling failed"
    );
    return status(400, { ok: false });
  }
});
