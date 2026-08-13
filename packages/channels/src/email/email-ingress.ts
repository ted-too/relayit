import type { Effect } from "effect";
import { Data } from "effect";
import type { ManagedDnsRecord } from "./managed-dns";

export class EmailIngressError extends Data.TaggedError("EmailIngressError")<{
  readonly cause: unknown;
  readonly operation: "ensure-domain" | "handle" | "remove-domain";
}> {}

export interface EnsureInboundDomainInput {
  readonly domain: string;
}

export interface InboundDomainPlan {
  readonly managedDnsRecords: readonly ManagedDnsRecord[];
}

export interface RawInboundEmail {
  readonly envelopeFrom: string;
  readonly envelopeTo: string;
  readonly headers: Headers;
  readonly raw: Uint8Array;
}

export interface InboundEmailAttachment {
  readonly content: Uint8Array;
  readonly contentId?: string;
  readonly contentType: string;
  readonly filename?: string;
}

export interface InboundEmail {
  readonly attachments: readonly InboundEmailAttachment[];
  readonly cc: readonly string[];
  readonly from: string;
  readonly headers: Headers;
  readonly html?: string;
  readonly messageId?: string;
  readonly subject?: string;
  readonly text?: string;
  readonly to: readonly string[];
}

export interface EmailIngressAdapter {
  readonly ensureDomain: (
    input: EnsureInboundDomainInput
  ) => Effect.Effect<InboundDomainPlan, EmailIngressError>;
  readonly handle: (
    input: RawInboundEmail
  ) => Effect.Effect<InboundEmail, EmailIngressError>;
  readonly id: string;
  readonly removeDomain: (
    input: EnsureInboundDomainInput
  ) => Effect.Effect<void, EmailIngressError>;
}
