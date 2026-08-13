import type { OpenedProviderCredentials } from "@repo/persistence/crypto/provider-credentials";
import type {
  DnsRecordPurpose,
  EmailDnsRecordInsert,
  Provider,
} from "@repo/persistence/db/schema";
import type { Effect } from "effect";
import type { ProviderOperationError } from "../provider-errors";
import type { EmailProviderTypeDefinition } from "../provider-type";
import type { EmailProviderInfrastructureAdapter } from "./provider-infrastructure";
import type { ProviderEmailMessage } from "./provider-message";
import type { EmailProviderWebhookAdapter } from "./provider-webhook";

export interface CreateIdentityInput {
  readonly dkimPrivateKey: string;
  readonly dkimSelector: string;
  readonly fqdn: string;
}

export interface MailFromSpec {
  readonly domain: string;
  readonly records: readonly MailFromDnsRecord[];
}

export interface IdentityResult {
  readonly mailFrom: MailFromSpec;
  readonly providerData: Readonly<Record<string, unknown>>;
}

export interface IdentityStatusInput {
  readonly fqdn: string;
}

export interface IdentityStatus {
  readonly dkimVerified: boolean;
  readonly verified: boolean;
}

export interface SendEmailResult {
  readonly providerMessageId: string;
}

export type MailFromDnsRecord = Pick<
  EmailDnsRecordInsert,
  "name" | "priority" | "recordType" | "value"
> & {
  readonly purpose: Extract<DnsRecordPurpose, "mail_from_mx" | "mail_from_spf">;
};

export interface EmailProviderAdapter {
  readonly checkConnection: Effect.Effect<boolean, ProviderOperationError>;
  readonly createIdentity: (
    input: CreateIdentityInput
  ) => Effect.Effect<IdentityResult, ProviderOperationError>;
  readonly definition: EmailProviderTypeDefinition;
  readonly deleteIdentity: (
    input: IdentityStatusInput
  ) => Effect.Effect<void, ProviderOperationError>;
  readonly getIdentityStatus: (
    input: IdentityStatusInput
  ) => Effect.Effect<IdentityStatus, ProviderOperationError>;
  readonly infrastructure?: EmailProviderInfrastructureAdapter;
  readonly send: (
    message: ProviderEmailMessage
  ) => Effect.Effect<SendEmailResult, ProviderOperationError>;
}

export interface CreateEmailProviderInput {
  readonly credentials: OpenedProviderCredentials;
  readonly providerId: Provider["id"];
}

export interface EmailProviderFactory {
  readonly create: (
    input: CreateEmailProviderInput
  ) => Effect.Effect<EmailProviderAdapter, ProviderOperationError>;
  readonly definition: EmailProviderTypeDefinition;
  /** Type-level notification ingress — no provider credentials required. */
  readonly webhooks?: EmailProviderWebhookAdapter;
}
