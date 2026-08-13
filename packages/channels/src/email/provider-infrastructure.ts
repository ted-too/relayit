import type { Effect } from "effect";
import type { ProviderOperationError } from "../provider-errors";
import type { ManagedDnsRecord } from "./managed-dns";

export interface EnsureProviderInfrastructureInput {
  readonly deliveryWebhookUrl: string;
}

export interface ProviderInfrastructurePlan {
  readonly managedDnsRecords: readonly ManagedDnsRecord[];
}

export interface EmailProviderInfrastructureAdapter {
  readonly ensure: (
    input: EnsureProviderInfrastructureInput
  ) => Effect.Effect<ProviderInfrastructurePlan, ProviderOperationError>;
  readonly teardown: (
    input: EnsureProviderInfrastructureInput
  ) => Effect.Effect<void, ProviderOperationError>;
}
