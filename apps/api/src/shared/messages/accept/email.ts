import {
  deleteStagedEmailAttachments,
  resolveEmailAttachments,
  stageEmailAttachments,
} from "@repo/api/channels/email/attachments";
import { filterSeverityAllRecipients } from "@repo/api/channels/email/deliverability/suppression";
import { resolveEmailSender } from "@repo/api/channels/email/sender";
import { findOrUpsertContact } from "@repo/api/contacts/contact";
import { type DbOrTx, type ProviderKind, schema } from "@repo/api/db";
import { emitWebhookEvent } from "@repo/api/messages/webhooks";
import { emailSendQueue } from "@repo/api/send";
import {
  renderEmailTemplateVariant,
  resolveTemplateRef,
} from "@repo/api/templating";
import { findOrCreateAppEnvironment } from "@repo/api/tenancy/app-environment";
import { resolveBillingUserId } from "@repo/api/tenancy/billing-user";
import {
  consumeChannelSendQuota,
  resolveBillingPeriod,
  rollbackChannelSendQuota,
} from "@repo/api/tenancy/plans";
import { logger } from "@repo/api/utils";
import type { SendEmailBody } from "@repo/api/validators/routes/messages";
import type { RedisClient } from "bun";

export interface AcceptTransactionalEmailInput {
  /** App / Environment headers — both or neither. */
  app?: string;
  body: SendEmailBody;
  db: DbOrTx;
  environment?: string;
  idempotencyKey?: string;
  organizationId: string;
  redis: RedisClient;
}

export type AcceptTransactionalEmailResult =
  | {
      ok: true;
      messageId: string;
      deliveryId: string;
      stripped?: { email: string; reason: string }[];
    }
  | {
      ok: false;
      status: 400 | 409 | 422 | 429 | 500;
      code: string;
      message: string;
      retryAfterSeconds?: number;
    };

function validateAppEnvironmentPair(
  app: string | undefined,
  environment: string | undefined
): AcceptTransactionalEmailResult | null {
  const hasApp = app != null && app.length > 0;
  const hasEnvironment = environment != null && environment.length > 0;
  if (hasApp === hasEnvironment) {
    return null;
  }
  return {
    ok: false,
    status: 400,
    code: "invalid_app_environment",
    message:
      "App and Environment headers must both be present, or both omitted.",
  };
}

async function resolveProviderKindForSender({
  db,
  sender,
}: {
  db: DbOrTx;
  sender: Awaited<ReturnType<typeof resolveEmailSender>>;
}): Promise<ProviderKind> {
  if (!sender || sender.kind === "sandbox") {
    return "managed";
  }

  const identity = await db.query.emailDomainProviderIdentity.findFirst({
    where: (table, { eq: equals, and: combine }) =>
      combine(
        equals(table.customDomainId, sender.customDomainId),
        equals(table.isActive, true),
        equals(table.verificationStatus, "verified")
      ),
    with: { provider: { columns: { scope: true } } },
  });

  return identity?.provider.scope === "platform" ? "managed" : "byo";
}

async function assertSandboxRecipientsAreMembers({
  db,
  organizationId,
  recipients,
}: {
  db: DbOrTx;
  organizationId: string;
  recipients: { email: string }[];
}): Promise<AcceptTransactionalEmailResult | null> {
  const members = await db.query.member.findMany({
    where: (table, { eq: equals }) =>
      equals(table.organizationId, organizationId),
    with: { user: { columns: { email: true } } },
  });

  const memberEmails = new Set(
    members.map((m) => m.user.email.trim().toLowerCase())
  );

  for (const recipient of recipients) {
    if (!memberEmails.has(recipient.email.trim().toLowerCase())) {
      return {
        ok: false,
        status: 422,
        code: "sandbox_recipient_not_member",
        message:
          "Sandbox Domain sends may only target Project member email addresses.",
      };
    }
  }

  return null;
}

/**
 * Accept a transactional `/messages/email` send: create Message + email Delivery,
 * reserve Usage, enqueue/schedule. Returns the Message id (Resend `{ id }`).
 */
export async function acceptTransactionalEmail(
  input: AcceptTransactionalEmailInput
): Promise<AcceptTransactionalEmailResult> {
  const pairError = validateAppEnvironmentPair(input.app, input.environment);
  if (pairError) {
    return pairError;
  }

  const { db, redis, organizationId, body } = input;
  const start = new Date();

  const idempotencyKey = input.idempotencyKey;
  if (idempotencyKey) {
    const appEnvironment = await findOrCreateAppEnvironment({
      db,
      organizationId,
      app: input.app ?? null,
      environment: input.environment ?? null,
    });

    const existing = await db.query.message.findFirst({
      where: (table, { eq: equals, and: combine }) =>
        combine(
          equals(table.organizationAppEnvironmentId, appEnvironment.id),
          equals(table.idempotencyKey, idempotencyKey)
        ),
      columns: { id: true },
    });

    if (existing) {
      const delivery = await db.query.emailDelivery.findFirst({
        where: (table, { eq: equals }) => equals(table.messageId, existing.id),
        columns: { id: true },
      });
      if (delivery) {
        return {
          ok: true,
          messageId: existing.id,
          deliveryId: delivery.id,
        };
      }
    }
  }

  let channelFormat: {
    subject: string;
    html?: string;
    text?: string;
  };
  let templateId: string | undefined;

  if (body.template) {
    const template = await resolveTemplateRef({
      db,
      organizationId,
      idOrSlug: body.template.id,
    });

    if (!template) {
      return {
        ok: false,
        status: 422,
        code: "template_not_found",
        message: "Template not found (or archived) for this Project.",
      };
    }

    const variant = await db.query.templateChannelVariant.findFirst({
      where: (table, { eq: equals, and: combine }) =>
        combine(
          equals(table.templateId, template.id),
          equals(table.channel, "email")
        ),
    });

    const rendered = await renderEmailTemplateVariant({
      variant,
      values: body.template.variables,
      subjectOverride: body.subject,
    });

    if (!rendered.ok) {
      return {
        ok: false,
        status: 422,
        code: rendered.error.code,
        message: rendered.error.message,
      };
    }

    channelFormat = rendered.value;
    templateId = template.id;
  } else if (body.html || body.text) {
    if (body.subject == null || body.subject.length === 0) {
      return {
        ok: false,
        status: 422,
        code: "missing_subject",
        message: "subject is required when sending inline html/text.",
      };
    }
    channelFormat = {
      subject: body.subject,
      html: body.html,
      text: body.text,
    };
  } else {
    return {
      ok: false,
      status: 422,
      code: "missing_body",
      message:
        "Provide html and/or text, or a Template (not both content sources).",
    };
  }

  const sender = await resolveEmailSender({
    db,
    organizationId,
    fromAddress: body.from.address,
  });

  if (!sender) {
    return {
      ok: false,
      status: 422,
      code: "invalid_from_address",
      message:
        "The 'from' address is not a verified sending domain for this project.",
    };
  }

  const organizationAppEnvironment = await findOrCreateAppEnvironment({
    db,
    organizationId,
    app: input.app ?? null,
    environment: input.environment ?? null,
  });

  const toFilter = await filterSeverityAllRecipients({
    db,
    organizationAppEnvironmentId: organizationAppEnvironment.id,
    recipients: body.to,
  });
  const ccFilter = body.cc
    ? await filterSeverityAllRecipients({
        db,
        organizationAppEnvironmentId: organizationAppEnvironment.id,
        recipients: body.cc,
      })
    : { kept: [], stripped: [] };
  const bccFilter = body.bcc
    ? await filterSeverityAllRecipients({
        db,
        organizationAppEnvironmentId: organizationAppEnvironment.id,
        recipients: body.bcc,
      })
    : { kept: [], stripped: [] };

  const stripped = [
    ...toFilter.stripped,
    ...ccFilter.stripped,
    ...bccFilter.stripped,
  ].map((r) => ({ email: r.email, reason: "suppression" as const }));

  const filteredTo = toFilter.kept;
  const filteredCc = body.cc ? ccFilter.kept : undefined;
  const filteredBcc = body.bcc ? bccFilter.kept : undefined;

  if (
    filteredTo.length === 0 &&
    (filteredCc?.length ?? 0) === 0 &&
    (filteredBcc?.length ?? 0) === 0
  ) {
    return {
      ok: false,
      status: 422,
      code: "all_recipients_suppressed",
      message:
        "Every recipient is suppressed at severity all; no deliverable addresses remain.",
    };
  }

  if (sender.kind === "sandbox") {
    const sandboxError = await assertSandboxRecipientsAreMembers({
      db,
      organizationId,
      recipients: [
        ...filteredTo,
        ...(filteredCc ?? []),
        ...(filteredBcc ?? []),
      ],
    });
    if (sandboxError) {
      return sandboxError;
    }
  }

  const providerKind = await resolveProviderKindForSender({ db, sender });

  const billingUserId = await resolveBillingUserId(organizationId);
  if (!billingUserId) {
    logger.error({ organizationId }, "Billing User not found for Project");
    return {
      ok: false,
      status: 500,
      code: "internal_server_error",
      message: "Billing User not found for Project.",
    };
  }

  const channelLimits = await db.query.userChannel.findFirst({
    where: (table, { eq: equals, and: combine }) =>
      combine(
        equals(table.userId, billingUserId),
        equals(table.channelType, "email")
      ),
  });

  if (!channelLimits) {
    logger.error(
      { billingUserId, organizationId },
      "Channel limits not found for Billing User"
    );
    return {
      ok: false,
      status: 500,
      code: "internal_server_error",
      message: "Channel limits not found for Billing User.",
    };
  }

  const period = await resolveBillingPeriod(billingUserId, start);

  const limitsExceeded = await consumeChannelSendQuota({
    channel: "email",
    purpose: "transactional",
    providerKind,
    limits: channelLimits.limits,
    userId: billingUserId,
    date: start,
    period,
    redis,
  });

  if (limitsExceeded) {
    return {
      ok: false,
      status: limitsExceeded.status,
      code: limitsExceeded.code,
      message: limitsExceeded.message,
      retryAfterSeconds: limitsExceeded.retryAfterSeconds,
    };
  }

  const scheduledAt = body.scheduled_at
    ? new Date(body.scheduled_at)
    : undefined;

  let resolvedAttachments:
    | Awaited<ReturnType<typeof resolveEmailAttachments>>
    | undefined;
  if (body.attachments?.length) {
    try {
      resolvedAttachments = await resolveEmailAttachments(body.attachments);
    } catch (error) {
      return {
        ok: false,
        status: 422,
        code: "invalid_attachment",
        message:
          error instanceof Error
            ? error.message
            : "One or more attachments could not be processed.",
      };
    }
  }

  let staged: { attachmentId: string; deliveryId: string }[] = [];

  try {
    const created = await db.transaction(async (tx) => {
      const [message] = await tx
        .insert(schema.message)
        .values({
          organizationAppEnvironmentId: organizationAppEnvironment.id,
          purpose: "transactional",
          templateId,
          tags: body.tags,
          idempotencyKey,
          scheduledAt,
        })
        .returning();

      const [delivery] = await tx
        .insert(schema.emailDelivery)
        .values({
          messageId: message.id,
          ...(sender.kind === "custom"
            ? { customDomainId: sender.customDomainId }
            : { sandboxDomainId: sender.sandboxDomainId }),
          status: "queued",
          from: body.from,
          to: filteredTo.map(({ email }) => email),
          cc: filteredCc?.map(({ email }) => email),
          bcc: filteredBcc?.map(({ email }) => email),
          replyTo: body.reply_to,
          subject: channelFormat.subject,
          html: channelFormat.html,
          text: channelFormat.text,
          headers: body.headers,
        })
        .returning();

      if (resolvedAttachments?.length) {
        staged = await stageEmailAttachments({
          db: tx,
          deliveryId: delivery.id,
          attachments: resolvedAttachments,
          scheduledAt,
        });
      }

      const recipientsByEmail = new Map<
        string,
        {
          email: string;
          first_name?: string;
          last_name?: string;
          properties?: Record<string, string>;
        }
      >();

      for (const recipient of [
        ...filteredTo,
        ...(filteredCc ?? []),
        ...(filteredBcc ?? []),
      ]) {
        const key = recipient.email.toLowerCase();
        const existing = recipientsByEmail.get(key);
        const mergedProperties = {
          ...recipient.properties,
          ...existing?.properties,
        };
        recipientsByEmail.set(key, {
          email: existing?.email ?? recipient.email,
          first_name: existing?.first_name ?? recipient.first_name,
          last_name: existing?.last_name ?? recipient.last_name,
          properties:
            Object.keys(mergedProperties).length > 0
              ? mergedProperties
              : undefined,
        });
      }

      for (const {
        email,
        first_name,
        last_name,
        properties,
      } of recipientsByEmail.values()) {
        await findOrUpsertContact({
          db: tx,
          organizationAppEnvironmentId: organizationAppEnvironment.id,
          identifier: { email },
          channel: "email",
          data: {
            firstName: first_name,
            lastName: last_name,
            properties,
          },
        });
      }

      return { message, delivery };
    });

    await emailSendQueue.delivery.with(redis).enqueue(
      {
        deliveryId: created.delivery.id,
        billingUserId,
        startDate: start.toISOString(),
        purpose: "transactional",
        providerKind,
      },
      {
        delay_until: scheduledAt,
      }
    );

    if (scheduledAt) {
      await emitWebhookEvent({
        db,
        redis,
        organizationId,
        type: "message.scheduled",
        messageTags: body.tags,
        payload: {
          message_id: created.message.id,
          delivery_id: created.delivery.id,
          scheduled_at: scheduledAt.toISOString(),
        },
      });
    }

    for (const recipient of [
      ...filteredTo,
      ...(filteredCc ?? []),
      ...(filteredBcc ?? []),
    ]) {
      await emitWebhookEvent({
        db,
        redis,
        organizationId,
        type: "contact.updated",
        payload: {
          email: recipient.email,
          source: "message.accept",
          message_id: created.message.id,
        },
      });
    }

    return {
      ok: true,
      messageId: created.message.id,
      deliveryId: created.delivery.id,
      ...(stripped.length > 0 ? { stripped } : {}),
    };
  } catch (error) {
    logger.error(error, "Failed to accept transactional email");
    if (staged.length > 0) {
      await deleteStagedEmailAttachments(staged).catch(() => undefined);
    }
    await rollbackChannelSendQuota({
      channel: "email",
      purpose: "transactional",
      providerKind,
      limits: channelLimits.limits,
      userId: billingUserId,
      date: start,
      period,
      redis,
    });
    return {
      ok: false,
      status: 500,
      code: "internal_server_error",
      message: "Failed to accept email message.",
    };
  }
}
