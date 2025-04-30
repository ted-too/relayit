import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Recommended for GCM
const AUTH_TAG_LENGTH = 16; // GCM standard auth tag length
const KEY_LENGTH = 32; // For AES-256
const ENCODING = "hex";
const DELIMITER = ":";

/**
 * Retrieves the encryption key from environment variables.
 * Throws an error if the key is missing or invalid.
 * @returns {Buffer} The encryption key as a Buffer.
 */
function getEncryptionKey(): Buffer {
  const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!keyHex) {
    throw new Error(
      "CREDENTIAL_ENCRYPTION_KEY environment variable is not set."
    );
  }
  const key = Buffer.from(keyHex, ENCODING);
  if (key.length !== KEY_LENGTH) {
    throw new Error(
      `CREDENTIAL_ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters long.`
    );
  }
  return key;
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * @param {string} text - The plaintext string to encrypt.
 * @returns {string} The encrypted string in the format 'iv:encryptedData:authTag' (hex encoded).
 * @throws {Error} If encryption fails or key is invalid.
 */
export function encrypt(text: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", ENCODING);
  encrypted += cipher.final(ENCODING);

  const authTag = cipher.getAuthTag();

  return [iv.toString(ENCODING), encrypted, authTag.toString(ENCODING)].join(
    DELIMITER
  );
}

/**
 * Decrypts an encrypted string (in 'iv:encryptedData:authTag' hex format) using AES-256-GCM.
 * @param {string} encryptedText - The encrypted string.
 * @returns {string} The original plaintext string.
 * @throws {Error} If decryption fails (e.g., invalid format, incorrect key, data integrity compromised).
 */
export function decrypt(encryptedText: string): string {
  const key = getEncryptionKey();
  const parts = encryptedText.split(DELIMITER);

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted text format.");
  }

  const [ivHex, encryptedDataHex, authTagHex] = parts;

  const iv = Buffer.from(ivHex, ENCODING);
  const encryptedData = Buffer.from(encryptedDataHex, ENCODING);
  const authTag = Buffer.from(authTagHex, ENCODING);

  if (iv.length !== IV_LENGTH) {
    throw new Error("Invalid IV length.");
  }
  if (authTag.length !== AUTH_TAG_LENGTH) {
    throw new Error("Invalid authTag length.");
  }

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, undefined, "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (error) {
    // Authentication failed or other decryption error
    console.error("Decryption failed:", error);
    throw new Error(
      "Failed to decrypt credentials. Data may be corrupt or key incorrect."
    );
  }
}

/**
 * Encrypts each value in a Record<string, string> while keeping the keys intact.
 * @param {Record<string, string>} record - The record with string values to encrypt.
 * @returns {Record<string, string>} A new record with the same keys but encrypted values.
 */
export function encryptRecord(
  record: Record<string, string>
): Record<string, string> {
  const encryptedRecord: Record<string, string> = {};

  for (const [key, value] of Object.entries(record)) {
    encryptedRecord[key] = encrypt(value);
  }

  return encryptedRecord;
}

/**
 * Decrypts each value in a Record<string, string> while keeping the keys intact.
 * @param {Record<string, string>} record - The record with encrypted string values.
 * @returns {Record<string, string>} A new record with the same keys but decrypted values.
 * @throws {Error} If decryption of any value fails.
 */
export function decryptRecord(
  record: Record<string, string>
): Record<string, string> {
  const decryptedRecord: Record<string, string> = {};

  for (const [key, value] of Object.entries(record)) {
    decryptedRecord[key] = decrypt(value);
  }

  return decryptedRecord;
}

export const redactedString = "●".repeat(8);

/**
 * Creates a safe version of an encrypted record by redacting the encrypted values.
 * Useful for logging or displaying sensitive data.
 * @param {Record<string, string>} record - The record with encrypted values
 * @returns {Record<string, string>} A new record with redacted values
 */
export function getSafeEncryptedRecord(
  record: Record<string, string>
): Record<string, string> {
  const safeRecord: Record<string, string> = {};

  for (const [key, value] of Object.entries(record)) {
    safeRecord[key] = redactedString; // Replace encrypted value with bullets
  }

  return safeRecord;
}
