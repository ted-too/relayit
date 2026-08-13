import type {
  EmailFrom,
  EmailHeaders,
} from "@repo/persistence/db/validators/channels/email";
import type { MessageContactInput } from "../../messages/accept/contacts";
import type { TransactionalMessageIntent } from "../../messages/accept/types";

export type EmailContentInput =
  | {
      readonly html?: string;
      readonly kind: "inline";
      readonly subject: string;
      readonly text?: string;
    }
  | {
      readonly idOrSlug: string;
      readonly kind: "template";
      readonly subjectOverride?: string;
      readonly values?: Readonly<Record<string, unknown>>;
    };

export interface EmailAttachmentInput {
  readonly contentId?: string;
  readonly contentType?: string;
  readonly filename: string;
  readonly source:
    | { readonly content: string; readonly kind: "base64" }
    | { readonly kind: "url"; readonly url: string };
}

export interface AcceptTransactionalEmailInput
  extends TransactionalMessageIntent {
  readonly email: {
    readonly attachments: readonly EmailAttachmentInput[];
    readonly bcc: readonly MessageContactInput[];
    readonly cc: readonly MessageContactInput[];
    readonly content: EmailContentInput;
    readonly from: EmailFrom;
    readonly headers: EmailHeaders;
    readonly replyTo: readonly string[];
    readonly to: readonly MessageContactInput[];
  };
}

export interface AcceptedTransactionalEmail {
  readonly deliveryId: string;
  readonly messageId: string;
  readonly replayed: boolean;
  readonly stripped: readonly {
    readonly email: string;
    readonly reason: "suppression";
  }[];
}
