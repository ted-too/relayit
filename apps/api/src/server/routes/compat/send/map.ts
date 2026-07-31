import { SANDBOX_FROM_LOCAL_PART } from "@repo/api/channels/email/sender";
import type { DbOrTx } from "@repo/api/db";
import type { AcceptTransactionalEmailResult } from "@repo/api/messages/accept";
import type {
  LegacySendRawBody,
  LegacySendTemplateBody,
} from "@repo/api/validators/routes/compat/send";
import { sendEmailBodySchema } from "@repo/api/validators/routes/messages";

export async function resolveLegacyDefaultFromAddress({
  db,
  organizationId,
}: {
  db: DbOrTx;
  organizationId: string;
}): Promise<string | null> {
  const org = await db.query.organization.findFirst({
    where: (table, { eq: equals }) => equals(table.id, organizationId),
    columns: { id: true },
    with: {
      sandboxDomain: {
        columns: {
          rootDomain: true,
          verificationStatus: true,
          isActive: true,
          isPaused: true,
        },
      },
    },
  });

  const sandbox = org?.sandboxDomain;
  if (
    !sandbox ||
    !sandbox.isActive ||
    sandbox.isPaused ||
    sandbox.verificationStatus !== "verified"
  ) {
    return null;
  }

  return `${SANDBOX_FROM_LOCAL_PART}@${sandbox.rootDomain}`;
}

function mapLegacyContact(
  to: string,
  contact:
    | {
        name?: string;
        externalIdentifiers?: Record<string, string>;
      }
    | undefined
) {
  if (!contact) {
    return { email: to };
  }

  const properties = contact.externalIdentifiers
    ? { ...contact.externalIdentifiers }
    : undefined;

  return {
    email: to,
    ...(contact.name ? { first_name: contact.name } : {}),
    ...(properties && Object.keys(properties).length > 0
      ? { properties }
      : {}),
  };
}

function mapLegacyAttachments(
  attachments: LegacySendRawBody["attachments"]
) {
  if (!attachments?.length) {
    return;
  }
  return attachments.map((attachment) => ({
    filename: attachment.filename,
    ...(attachment.content !== undefined
      ? { content: attachment.content }
      : { path: attachment.path as string }),
    ...(attachment.contentType
      ? { content_type: attachment.contentType }
      : {}),
    ...(attachment.contentId ? { content_id: attachment.contentId } : {}),
  }));
}

export async function mapLegacyRawToAcceptBody({
  db,
  organizationId,
  body,
}: {
  db: DbOrTx;
  organizationId: string;
  body: LegacySendRawBody;
}) {
  const from =
    body.from ??
    (await resolveLegacyDefaultFromAddress({ db, organizationId }));

  if (!from) {
    return {
      ok: false as const,
      status: 400 as const,
      message: "No sender identity available; pass from or provision Sandbox Domain",
      details: [] as string[],
    };
  }

  const parsed = sendEmailBodySchema.safeParse({
    from,
    to: mapLegacyContact(body.to, body.contact),
    subject: body.payload.subject,
    html: body.payload.html,
    text: body.payload.text,
    attachments: mapLegacyAttachments(body.attachments),
  });

  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400 as const,
      message: "Validation error",
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const appPair = legacyAppEnvironmentPair(body.app, body.appEnvironment);

  return {
    ok: true as const,
    body: parsed.data,
    ...appPair,
  };
}

export async function mapLegacyTemplateToAcceptBody({
  db,
  organizationId,
  body,
}: {
  db: DbOrTx;
  organizationId: string;
  body: LegacySendTemplateBody;
}) {
  const from =
    body.from ??
    (await resolveLegacyDefaultFromAddress({ db, organizationId }));

  if (!from) {
    return {
      ok: false as const,
      status: 400 as const,
      message: "No sender identity available; pass from or provision Sandbox Domain",
      details: [] as string[],
    };
  }

  const parsed = sendEmailBodySchema.safeParse({
    from,
    to: mapLegacyContact(body.to, body.contact),
    template: {
      id: body.template.slug,
      ...(body.template.props ? { variables: body.template.props } : {}),
    },
    attachments: mapLegacyAttachments(body.attachments),
  });

  if (!parsed.success) {
    return {
      ok: false as const,
      status: 400 as const,
      message: "Validation error",
      details: parsed.error.issues.map((issue) => issue.message),
    };
  }

  const appPair = legacyAppEnvironmentPair(body.app, body.appEnvironment);

  return {
    ok: true as const,
    body: parsed.data,
    ...appPair,
  };
}

/** New Accept requires App+Environment as a pair; drop partial legacy pairs. */
function legacyAppEnvironmentPair(
  app: string | undefined,
  appEnvironment: string | undefined
): { app?: string; environment?: string } {
  const hasApp = app != null && app.length > 0;
  const hasEnvironment = appEnvironment != null && appEnvironment.length > 0;
  if (hasApp && hasEnvironment) {
    return { app, environment: appEnvironment };
  }
  return {};
}

export function mapAcceptResultToLegacyResponse(
  result: AcceptTransactionalEmailResult
) {
  if (result.ok) {
    return {
      status: 201 as const,
      body: { id: result.messageId, status: "queued" as const },
    };
  }

  const status =
    result.status === 429
      ? 429
      : result.status === 409
        ? 409
        : result.status >= 500
          ? 500
          : 400;

  return {
    status,
    body: {
      message: result.message,
      details: [result.code],
    },
  };
}
