import type { ChannelSpecificData } from "@repo/shared/forms";

// Regex patterns defined at module level for performance
// biome-ignore lint/suspicious/noControlCharactersInRegex: ASCII control characters are intentionally checked
const ASCII_ONLY_REGEX = /^[\u0000-\u007F]*$/;
const ATOM_CHARS_REGEX = /^[a-zA-Z0-9!#$%&'*+\-/=?^_`{|}~]+$/;
const BACKSLASH_REGEX = /\\/g;
const QUOTE_REGEX = /"/g;
const BASE64_PADDING_REGEX = /=/g;

/**
 * RFC 5322 compliant escaping for quoted-strings
 * Escapes backslashes first, then quotes to avoid double-escaping
 * @param str - String to escape
 * @returns Escaped string safe for use in quoted-strings
 */
function escapeQuotedString(str: string): string {
  return str
    .replace(BACKSLASH_REGEX, "\\\\") // Escape backslashes first
    .replace(QUOTE_REGEX, '\\"'); // Then escape quotes
}

/**
 * RFC 2047 encoding for non-ASCII characters in email headers
 * @param str - String to encode
 * @returns RFC 2047 encoded string if non-ASCII present, otherwise original string
 */
function encodeHeaderValue(str: string): string {
  // Check if string contains non-ASCII characters
  if (!ASCII_ONLY_REGEX.test(str)) {
    // Use UTF-8 B-encoding for RFC 2047
    const encoded = Buffer.from(str, "utf8")
      .toString("base64")
      .replace(BASE64_PADDING_REGEX, ""); // Remove padding for cleaner output
    return `=?UTF-8?B?${encoded}?=`;
  }
  return str;
}

/**
 * Determines if a display name needs quoting per RFC 5322
 * @param str - Display name to check
 * @returns true if quoting is required
 */
function needsQuoting(str: string): boolean {
  // RFC 5322: atom characters are alphanumeric plus: ! # $ % & ' * + - / = ? ^ _ ` { | } ~
  // Any character outside this set requires quoting
  return !ATOM_CHARS_REGEX.test(str);
}

/**
 * Formats an email identity with display name if available
 * RFC 5322 and RFC 2047 compliant formatting
 * @param identity - The provider identity with channel data
 * @returns Formatted email string (e.g., "Display Name" <email@domain.com> or email@domain.com)
 */
export function formatEmailIdentity(identity: {
  identifier: string;
  channelData?: ChannelSpecificData;
}): string {
  const emailData = identity.channelData?.email;
  const displayName = emailData?.name?.trim();

  if (displayName) {
    // Apply RFC 2047 encoding for non-ASCII characters
    const encodedName = encodeHeaderValue(displayName);

    // Check if the encoded name needs quoting
    if (needsQuoting(encodedName)) {
      // RFC 5322 compliant escaping and quoting
      const escapedName = escapeQuotedString(encodedName);
      return `"${escapedName}" <${identity.identifier}>`;
    }
    // No quoting needed for simple atom
    return `${encodedName} <${identity.identifier}>`;
  }

  return identity.identifier;
}
