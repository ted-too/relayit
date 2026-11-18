import type {
  DnsRecordPurpose,
  EmailDelivery,
  EmailDnsRecordInsert,
} from "@repo/persistence/db/schema";
import { Context, Data, type Effect } from "effect";

/**
 * What email goes through: the deployment's SES account, in the regions ops configures
 * (`SES_REGIONS`), or the local stand-in. A Domain is registered in one region and always
 * sent through it. `region: null` is a registration made before regions were recorded,
 * which is in the default region.
 */
export interface EmailBackendService {
  /** Where a new Domain is registered: the first of `SES_REGIONS`. */
  readonly defaultRegion: string;
  readonly createIdentity: (
    input: EmailIdentityRef & {
      readonly dkimPrivateKey: string;
      readonly dkimSelector: string;
    },
  ) => Effect.Effect<IdentityResult, EmailBackendError>;
  readonly deleteIdentity: (input: EmailIdentityRef) => Effect.Effect<void, EmailBackendError>;
  /** The configuration set and notification topic in every region, pointed at the api. */
  readonly ensureInfrastructure: (input: {
    readonly deliveryWebhookUrl: string;
  }) => Effect.Effect<void, EmailBackendError>;
  readonly getIdentityStatus: (
    input: EmailIdentityRef,
  ) => Effect.Effect<IdentityStatus, EmailBackendError>;
  readonly send: (input: {
    readonly message: OutboundEmail;
    readonly region: string | null;
  }) => Effect.Effect<SendEmailResult, EmailBackendError>;
}

export class EmailBackend extends Context.Service<EmailBackend, EmailBackendService>()(
  "Channels/EmailBackend",
) {}

export interface EmailIdentityRef {
  readonly fqdn: string;
  readonly region: string | null;
}

export type MailFromDnsRecord = Pick<
  EmailDnsRecordInsert,
  "name" | "priority" | "recordType" | "value"
> & {
  readonly purpose: Extract<DnsRecordPurpose, "mail_from_mx" | "mail_from_spf">;
};

export interface IdentityResult {
  readonly mailFrom: {
    readonly domain: string;
    readonly records: readonly MailFromDnsRecord[];
  };
}

export interface IdentityStatus {
  readonly dkimVerified: boolean;
  readonly verified: boolean;
}

export interface SendEmailResult {
  /** SES's message id, which its notifications name the message by. */
  readonly providerMessageId: string;
}

export interface OutboundEmailAttachment {
  readonly content: string;
  readonly contentId?: string;
  readonly contentType?: string;
  readonly filename: string;
}

export interface OutboundEmail extends Pick<
  EmailDelivery,
  "bcc" | "cc" | "from" | "headers" | "html" | "replyTo" | "subject" | "text" | "to"
> {
  readonly attachments?: readonly OutboundEmailAttachment[];
  /**
   * Which Project is sending and from which Domain or Sandbox Domain, so SES can keep
   * that Project's reputation apart on the shared account (one tenant per Project).
   */
  readonly sender: {
    readonly identityFqdn: string;
    readonly projectId: string;
  };
}

export class EmailBackendAuthenticationError extends Data.TaggedError(
  "EmailBackendAuthenticationError",
)<{
  readonly cause?: unknown;
  readonly region: string;
}> {}

export class EmailBackendConfigurationError extends Data.TaggedError(
  "EmailBackendConfigurationError",
)<{
  readonly cause?: unknown;
  readonly code: "configuration_rejected" | "invalid_webhook_url" | "unknown_region";
  readonly region: string;
}> {}

export class EmailBackendRateLimited extends Data.TaggedError("EmailBackendRateLimited")<{
  readonly region: string;
  readonly retryAfterMs?: number;
}> {}

export class EmailBackendRejected extends Data.TaggedError("EmailBackendRejected")<{
  readonly cause?: unknown;
  readonly reason: string;
  readonly region: string;
}> {}

export class EmailBackendMessageError extends Data.TaggedError("EmailBackendMessageError")<{
  readonly cause?: unknown;
  readonly code: "invalid_attachment_encoding";
  readonly filename: string;
  readonly region: string;
}> {}

export class EmailBackendUnavailable extends Data.TaggedError("EmailBackendUnavailable")<{
  readonly cause?: unknown;
  readonly region: string;
}> {}

export type EmailBackendError =
  | EmailBackendAuthenticationError
  | EmailBackendConfigurationError
  | EmailBackendMessageError
  | EmailBackendRateLimited
  | EmailBackendRejected
  | EmailBackendUnavailable;
