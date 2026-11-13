import type { EmailDelivery } from "@repo/persistence/db/schema";

export interface ProviderEmailAttachment {
  readonly content: string;
  readonly contentId?: string;
  readonly contentType?: string;
  readonly filename: string;
}

type ProviderEmailDeliveryFields = Pick<
  EmailDelivery,
  "bcc" | "cc" | "from" | "headers" | "html" | "replyTo" | "subject" | "text" | "to"
>;

/**
 * Sending on a shared (managed) Provider: which Project is sending and from
 * which Domain / Sandbox Domain identity, so the vendor can isolate that
 * Project's reputation (SES: one tenant per Project). Absent for BYO.
 */
export interface ProviderEmailSender {
  readonly identityFqdn: string;
  readonly projectId: string;
}

export interface ProviderEmailMessage extends ProviderEmailDeliveryFields {
  readonly attachments?: readonly ProviderEmailAttachment[];
  readonly sender?: ProviderEmailSender;
}
