import type { EmailDelivery } from "@repo/persistence/db/schema";

export interface ProviderEmailAttachment {
  readonly content: string;
  readonly contentId?: string;
  readonly contentType?: string;
  readonly filename: string;
}

type ProviderEmailDeliveryFields = Pick<
  EmailDelivery,
  | "bcc"
  | "cc"
  | "from"
  | "headers"
  | "html"
  | "replyTo"
  | "subject"
  | "text"
  | "to"
>;

export interface ProviderEmailMessage extends ProviderEmailDeliveryFields {
  readonly attachments?: readonly ProviderEmailAttachment[];
}
