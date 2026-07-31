import { db } from "@repo/api/db";
import { IS_CLOUD_EDITION, WEBHOOK_BASE_URL } from "@repo/api/env";
import {
  bootstrapDmarcReceiving,
  dmarcInboundWebhookUrl,
} from "@repo/api/providers/aws/email/dmarc-receiving";
import { logger } from "@repo/api/utils";

export async function bootstrapPlatformEmailReceiving() {
  if (!IS_CLOUD_EDITION) {
    return;
  }

  const platformProvider = await db.query.provider.findFirst({
    where: (table, { and, eq }) =>
      and(eq(table.scope, "platform"), eq(table.channelType, "email")),
  });

  if (!platformProvider) {
    logger.warn(
      "No platform email provider found; skipping DMARC receiving bootstrap"
    );
    return;
  }

  const webhookUrl = dmarcInboundWebhookUrl(WEBHOOK_BASE_URL);

  try {
    await bootstrapDmarcReceiving({
      credentials: platformProvider.credentials,
      webhookUrl,
    });
  } catch (error) {
    logger.error({ error }, "Platform DMARC receiving bootstrap failed");
  }
}
