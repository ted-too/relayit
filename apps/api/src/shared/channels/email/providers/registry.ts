import { createCustomDomainOps } from "../sending-identity/custom-domain";
import { createSandboxDomainOps } from "../sending-identity/sandbox";
import type { ClientEmailRegistryConfig, EmailVendorOps } from "../types";
import { createProviderOps } from "./provider-ops";

/**
 * Assemble the runtime email registry config for a vendor (SES, etc.).
 *
 * Kept in this leaf module — rather than a channels/email barrel — so the
 * provider configs (`providers/aws/email/runtime`) can import it without pulling
 * in task modules that import the provider registry (avoids a
 * `channels ⇄ providers` module-init cycle / TDZ on this function).
 */
export const buildRuntimeEmailRegistryConfig = ({
  clientConfig,
  ...vendor
}: {
  clientConfig: ClientEmailRegistryConfig;
} & EmailVendorOps) => {
  const sandboxDomain = createSandboxDomainOps(vendor);

  return {
    ...clientConfig,
    provider: createProviderOps({ vendor, sandboxDomain }),
    customDomain: createCustomDomainOps(vendor),
    sandboxDomain,
    send: vendor.send,
    webhooks: vendor.webhooks,
  };
};
