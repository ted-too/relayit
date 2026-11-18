import type { AcceptTransactionalEmailInput } from "@repo/channels/email/accept";
import { SANDBOX_FROM_LOCAL_PART } from "@repo/channels/email/sender";
import type { PromiseDb } from "@repo/persistence/db/promise";
import { tryParseEmailFrom } from "../../messages/validators/email";
import type { LegacySendRawBody, LegacySendTemplateBody } from "./validators";

type LegacySendContact = NonNullable<LegacySendRawBody["contact"]>;
type LegacySendAttachment = NonNullable<LegacySendRawBody["attachments"]>[number];

export type LegacyMapResult =
  | { readonly input: AcceptTransactionalEmailInput; readonly ok: true }
  | {
      readonly details: readonly string[];
      readonly message: string;
      readonly ok: false;
      readonly status: 400;
    };

const mapLegacyContact = (to: string, contact: LegacySendContact | undefined) => {
  if (!contact) {
    return { email: to };
  }

  const properties = contact.externalIdentifiers ? { ...contact.externalIdentifiers } : undefined;

  return {
    email: to,
    ...(contact.name ? { firstName: contact.name } : {}),
    ...(properties && Object.keys(properties).length > 0 ? { properties } : {}),
  };
};

const attributionFromLegacy = (
  app: string | undefined,
  appEnvironment: string | undefined,
): AcceptTransactionalEmailInput["attribution"] => {
  const hasApp = app != null && app.length > 0;
  const hasEnvironment = appEnvironment != null && appEnvironment.length > 0;
  if (hasApp && hasEnvironment) {
    return { app, environment: appEnvironment, kind: "appEnvironment" };
  }
  return { kind: "project" };
};

const mapLegacyAttachments = (
  attachments: readonly LegacySendAttachment[] | undefined,
): AcceptTransactionalEmailInput["email"]["attachments"] => {
  if (!attachments?.length) {
    return [];
  }

  return attachments.map((attachment) => ({
    filename: attachment.filename,
    source:
      "path" in attachment
        ? { kind: "url" as const, url: attachment.path }
        : { content: attachment.content, kind: "base64" as const },
    ...(attachment.contentId ? { contentId: attachment.contentId } : {}),
    ...(attachment.contentType ? { contentType: attachment.contentType } : {}),
  }));
};

const resolveMappedFrom = (input: {
  readonly bodyFrom: string | undefined;
  readonly from: string | undefined;
}):
  | Extract<LegacyMapResult, { ok: false }>
  | {
      readonly from: AcceptTransactionalEmailInput["email"]["from"];
      readonly ok: true;
    } => {
  const from = input.from ?? input.bodyFrom;
  if (!from) {
    return {
      details: [],
      message: "No sender identity available; pass from or provision Sandbox Domain",
      ok: false,
      status: 400,
    };
  }

  const parsedFrom = tryParseEmailFrom(from);
  if (parsedFrom === undefined) {
    return {
      details: ["Invalid from address"],
      message: "Validation error",
      ok: false,
      status: 400,
    };
  }

  return { from: parsedFrom, ok: true };
};

export const mapLegacyRawToAccept = (input: {
  readonly body: LegacySendRawBody;
  readonly from?: string;
  readonly organizationId: string;
}): LegacyMapResult => {
  const from = resolveMappedFrom({
    bodyFrom: input.body.from,
    from: input.from,
  });
  if (!from.ok) {
    return from;
  }

  return {
    input: {
      attribution: attributionFromLegacy(input.body.app, input.body.appEnvironment),
      email: {
        attachments: mapLegacyAttachments(input.body.attachments),
        bcc: [],
        cc: [],
        content: {
          html: input.body.payload.html,
          kind: "inline",
          subject: input.body.payload.subject,
          text: input.body.payload.text,
        },
        from: from.from,
        headers: {},
        replyTo: [],
        to: [mapLegacyContact(input.body.to, input.body.contact)],
      },
      organizationId: input.organizationId,
    },
    ok: true,
  };
};

export const mapLegacyTemplateToAccept = (input: {
  readonly body: LegacySendTemplateBody;
  readonly from?: string;
  readonly organizationId: string;
}): LegacyMapResult => {
  const from = resolveMappedFrom({
    bodyFrom: input.body.from,
    from: input.from,
  });
  if (!from.ok) {
    return from;
  }

  return {
    input: {
      attribution: attributionFromLegacy(input.body.app, input.body.appEnvironment),
      email: {
        attachments: mapLegacyAttachments(input.body.attachments),
        bcc: [],
        cc: [],
        content: {
          idOrSlug: input.body.template.slug,
          kind: "template",
          values: input.body.template.props,
        },
        from: from.from,
        headers: {},
        replyTo: [],
        to: [mapLegacyContact(input.body.to, input.body.contact)],
      },
      organizationId: input.organizationId,
    },
    ok: true,
  };
};

/** Local part used when a legacy send omits `from` and a custom Domain is used. */
export const LEGACY_DEFAULT_FROM_LOCAL_PART = "noreply";

/**
 * Sender for legacy sends that omit `from`. Prod Relayit fell back to the
 * Project's default identity (e.g. `noreply@acme.com`), so prefer the
 * Project's oldest sendable custom Domain, then the Sandbox Domain.
 */
export const resolveLegacyDefaultFromAddress = async (input: {
  readonly db: PromiseDb;
  readonly organizationId: string;
}): Promise<string | null> => {
  const linkedDomain = await input.db.query.organizationDomain.findFirst({
    columns: { customDomainId: true },
    orderBy: { createdAt: "asc" },
    where: {
      customDomain: { isPaused: false, verificationStatus: "verified" },
      organizationId: input.organizationId,
    },
    with: { customDomain: { columns: { fqdn: true } } },
  });

  if (linkedDomain?.customDomain) {
    return `${LEGACY_DEFAULT_FROM_LOCAL_PART}@${linkedDomain.customDomain.fqdn}`;
  }

  const organization = await input.db.query.organization.findFirst({
    columns: { id: true },
    where: { id: input.organizationId },
    with: {
      sandboxDomain: {
        columns: {
          isActive: true,
          isPaused: true,
          rootDomain: true,
          verificationStatus: true,
        },
      },
    },
  });

  const sandbox = organization?.sandboxDomain;
  const canSendFromSandbox =
    sandbox?.isActive === true &&
    sandbox.isPaused === false &&
    sandbox.verificationStatus === "verified";
  if (!(canSendFromSandbox && sandbox)) {
    return null;
  }

  return `${SANDBOX_FROM_LOCAL_PART}@${sandbox.rootDomain}`;
};
