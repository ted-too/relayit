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
 * Which Project is sending and from which Domain / Sandbox Domain identity, so the
 * vendor can isolate that Project's reputation on the shared account (SES: one tenant
 * per Project).
 */
export interface ProviderEmailSender {
  readonly identityFqdn: string;
  readonly projectId: string;
}

export interface ProviderEmailMessage extends ProviderEmailDeliveryFields {
  readonly attachments?: readonly ProviderEmailAttachment[];
  readonly sender: ProviderEmailSender;
}
