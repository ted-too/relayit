import { env } from "@repo/api/env";

/** Inbound unsubscribe requests: `unsubscribe.<CF_ROOT_DOMAIN>` (cloud only). */
export function getUnsubscribeInboundDomain(): string {
  if (!env.CF_ROOT_DOMAIN) {
    throw new Error("CF_ROOT_DOMAIN is required for unsubscribe inbound");
  }
  return `unsubscribe.${env.CF_ROOT_DOMAIN}`;
}

export function parseUnsubscribeRecipient(
  address: string
): { contactId: string; signature: string } | null {
  if (!env.CF_ROOT_DOMAIN) {
    return null;
  }

  const suffix = `@unsubscribe.${env.CF_ROOT_DOMAIN}`;
  const normalized = address.trim().toLowerCase();
  if (!normalized.endsWith(suffix)) {
    return null;
  }

  const localPart = normalized.slice(0, -suffix.length);
  const separatorIndex = localPart.indexOf(".");
  if (separatorIndex === -1) {
    return null;
  }

  const contactId = localPart.slice(0, separatorIndex);
  const signature = localPart.slice(separatorIndex + 1);
  if (!contactId) {
    return null;
  }
  if (!signature) {
    return null;
  }

  return { contactId, signature };
}
