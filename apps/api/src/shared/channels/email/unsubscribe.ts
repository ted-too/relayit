import { env } from "@repo/api/env";

/** Inbound unsubscribe requests: `unsubscribe.<CF_ROOT_DOMAIN>`. */
export const unsubscribeInboundDomain = `unsubscribe.${env.CF_ROOT_DOMAIN}`;

const UNSUBSCRIBE_DOMAIN_SUFFIX = `@${unsubscribeInboundDomain}`;

export function parseUnsubscribeRecipient(
  address: string
): { contactId: string; signature: string } | null {
  const normalized = address.trim().toLowerCase();
  if (!normalized.endsWith(UNSUBSCRIBE_DOMAIN_SUFFIX)) {
    return null;
  }

  const localPart = normalized.slice(0, -UNSUBSCRIBE_DOMAIN_SUFFIX.length);
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
