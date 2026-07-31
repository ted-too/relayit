import type {
  ChannelCredentials,
  ChannelRegistryConfig,
} from "@repo/api/channels/base";
import type {
  CustomDomain,
  DnsRecordPurpose,
  DomainVerificationStatus,
  EmailDeliveryEventKind,
  EmailDnsRecordInsert,
  EmailDomainProviderIdentity,
  OrganizationDomain,
  Provider,
  SandboxDomain,
} from "@repo/api/db";
import type { Result } from "@repo/api/utils";
import type {
  EmailFrom,
  EmailHeaders,
} from "@repo/api/validators/routes/messages";
import type z from "zod";

/** Resolved email payload handed to a Provider adapter (not the HTTP Accept body). */
export interface ProviderEmailMessage {
  attachments?: {
    filename: string;
    content: string;
    content_id?: string;
    content_type?: string;
  }[];
  bcc?: { email: string }[];
  cc?: { email: string }[];
  from: EmailFrom;
  headers?: EmailHeaders;
  html?: string;
  reply_to?: string[];
  subject: string;
  text?: string;
  to: { email: string }[];
}

export interface EmailDomainIdentityStatus {
  dkimVerified: boolean;
  verified: boolean;
}

/** Vendor mail-from DNS rows — column subset of `email_dns_record` insert. */
export type MailFromDnsRecordSpec = Pick<
  EmailDnsRecordInsert,
  "name" | "recordType" | "value" | "priority"
> & {
  purpose: Extract<DnsRecordPurpose, "mail_from_mx" | "mail_from_spf">;
};

export interface MailFromSpec {
  domain: string;
  records: MailFromDnsRecordSpec[];
}

export interface ClientEmailRegistryConfig
  extends ChannelRegistryConfig<"email"> {
  domainConfigSchema: z.core.$ZodObject;
}

export type DomainReadinessType =
  | {
      type: "sandbox-domain";
      customDomainId?: undefined;
      sandboxDomainId: SandboxDomain["id"];
    }
  | {
      type: "custom-domain";
      customDomainId: CustomDomain["id"];
      sandboxDomainId?: undefined;
    };

export type DomainReadinessResult = {
  activeRecords: number;
  missingRecords: number;
  nextCheckAt: CustomDomain["nextVerifyAt"];
  verificationStatus: DomainVerificationStatus;
} & DomainReadinessType;

/** Ownership verify task result — org↔domain link columns + aliased next check. */
export type OwnershipResult = Pick<
  OrganizationDomain,
  "customDomainId" | "organizationId" | "ownershipVerificationStatus"
> & {
  nextCheckAt: OrganizationDomain["ownershipNextVerifyAt"];
};

/**
 * Sending surface shared by the vendor primitive and the assembled registry
 * config. Vendor-agnostic so the router and send path depend on this, not SES.
 */
export interface EmailSendOps {
  raw(params: {
    credentials: ChannelCredentials;
    message: ProviderEmailMessage;
  }): Promise<Result<{ messageId: string }>>;
}

export interface NormalizedDeliveryEvent {
  kind: EmailDeliveryEventKind;
  providerMessageId: string;
  raw: unknown;
  recipients: string[];
  suppress: boolean;
}

export type WebhookResult =
  | { events: NormalizedDeliveryEvent[]; type: "events" }
  | { email: Uint8Array; recipients: string[]; type: "inbound" }
  | { type: "noop" };

export interface EmailWebhookOps {
  ensureNotifications(params: {
    credentials: ChannelCredentials;
    webhookUrl: string;
  }): Promise<void>;

  handle(params: { headers: Headers; rawBody: string }): Promise<WebhookResult>;

  teardownNotifications(params: {
    credentials: ChannelCredentials;
    webhookUrl: string;
  }): Promise<void>;
}

/**
 * The low-level, vendor-specific primitive (SES, etc.) that the domain,
 * sandbox, and provider ops collections are built on. This is the one contract
 * every vendor implements and that gets passed into the `create*Ops` factories,
 * so it stays an explicit interface.
 */
export interface EmailVendorOps {
  checkConnection(params: {
    credentials: ChannelCredentials;
  }): Promise<{ ok: boolean }>;

  createIdentity(params: {
    credentials: ChannelCredentials;
    fqdn: string;
    dkimSelector: string;
    dkimPrivateKey: string;
  }): Promise<{
    providerData: Record<string, unknown>;
    mailFrom: MailFromSpec;
  }>;

  deleteIdentity(params: {
    credentials: ChannelCredentials;
    fqdn: string;
  }): Promise<void>;

  getIdentityStatus(params: {
    credentials: ChannelCredentials;
    fqdn: string;
  }): Promise<EmailDomainIdentityStatus>;

  send: EmailSendOps;

  webhooks?: EmailWebhookOps;
}

export type RoutableProviderIdentity = EmailDomainProviderIdentity & {
  provider: Provider;
};
