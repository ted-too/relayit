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
  /**
   * Creates the Domain's identity, signing with its DKIM key. The account can hold
   * identities Relayit did not make (by hand, or another system's), and SES names one by its
   * FQDN alone, so one that already exists is taken as the Domain's only when it signs with
   * this very selector: the one an earlier attempt at this registration made. Any other
   * fails with `EmailBackendIdentityConflict` and is left exactly as it was.
   */
  readonly createIdentity: (
    input: EmailIdentityRef & {
      readonly dkimPrivateKey: string;
      readonly dkimSelector: string;
    },
  ) => Effect.Effect<IdentityResult, EmailBackendError>;
  /**
   * Deletes the identity a Domain was registered as: the one signing with `dkimSelector`.
   * An identity of that name signing with anything else is not that Domain's and stays.
   * Answers whether it deleted one: false when there was none, or none of the Domain's.
   */
  readonly deleteIdentity: (
    input: EmailIdentityRef & { readonly dkimSelector: string },
  ) => Effect.Effect<boolean, EmailBackendError>;
  /** The configuration set and notification topic in every region, pointed at the api. */
  readonly ensureInfrastructure: (input: {
    readonly deliveryWebhookUrl: string;
  }) => Effect.Effect<void, EmailBackendError>;
  readonly getIdentityStatus: (
    input: EmailIdentityRef,
  ) => Effect.Effect<IdentityStatus, EmailBackendError>;
  /**
   * Whether SES lets the Project send from a region right now. SES keeps a Project's
   * reputation, and pauses it, per region; `absent` is a Project that has never sent from
   * this one.
   */
  readonly getProjectSendingStatus: (input: {
    readonly projectId: string;
    readonly region: string;
  }) => Effect.Effect<ProjectSendingStatus, EmailBackendError>;
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

export type ProjectSendingStatus = "absent" | "enabled" | "paused";

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

/**
 * An identity of this name exists in the region that was not made with the Domain's DKIM
 * selector, so it is not Relayit's to take over or replace. Nothing was changed.
 */
export class EmailBackendIdentityConflict extends Data.TaggedError("EmailBackendIdentityConflict")<{
  readonly fqdn: string;
  readonly region: string;
}> {}

export class EmailBackendRateLimited extends Data.TaggedError("EmailBackendRateLimited")<{
  readonly region: string;
  readonly retryAfterMs?: number;
}> {}

/** SES refused the send, or the request provably never reached SES: nothing went out. */
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
  | EmailBackendIdentityConflict
  | EmailBackendMessageError
  | EmailBackendRateLimited
  | EmailBackendRejected
  | EmailBackendUnavailable;
