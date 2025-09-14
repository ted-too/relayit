import type { ChannelSpecificData } from "@repo/shared/forms";

/**
 * Formats an email identity with display name if available
 * @param identity - The provider identity with channel data
 * @returns Formatted email string (e.g., "Display Name" <email@domain.com> or email@domain.com)
 */
export function formatEmailIdentity(identity: { 
  identifier: string; 
  channelData?: ChannelSpecificData
}): string {
  const emailData = identity.channelData?.email;
  const displayName = emailData?.name?.trim();
  
  if (displayName) {
    // Escape quotes in display name and wrap in quotes
    const escapedName = displayName.replace(/"/g, '\\"');
    return `"${escapedName}" <${identity.identifier}>`;
  }
  
  return identity.identifier;
}
