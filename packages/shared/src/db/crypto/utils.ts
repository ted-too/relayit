import crypto from "node:crypto";
import { createGenericError, type Result } from "@/utils";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Recommended for GCM
const AUTH_TAG_LENGTH = 16; // GCM standard auth tag length
const KEY_LENGTH = 32; // For AES-256
const ENCODING = "hex";
const DELIMITER = ":";
/**
 * Gets the current key version from environment
 */
function getCurrentKeyVersion(): string {
  return process.env.ENCRYPTION_KEY_VERSION || "v1";
}

/**
 * Retrieves the encryption key for a specific version from environment variables.
 * @param version - Key version (defaults to current version)
 * @returns {Result<Buffer>} The encryption key as a Buffer or an error.
 */
function getEncryptionKey(
  version: string = getCurrentKeyVersion()
): Result<Buffer> {
  try {
    const versionedKeyVar = `CREDENTIAL_ENCRYPTION_KEY_${version.toUpperCase()}`;
    const keyHex = process.env[versionedKeyVar];

    if (!keyHex) {
      return {
        error: createGenericError(
          `Encryption key not found for version ${version}. Expected: ${versionedKeyVar}`
        ),
        data: null,
      };
    }

    const key = Buffer.from(keyHex, ENCODING);
    if (key.length !== KEY_LENGTH) {
      return {
        error: createGenericError(
          `Encryption key ${version} must be ${KEY_LENGTH * 2} hex characters long.`
        ),
        data: null,
      };
    }

    return { error: null, data: key };
  } catch (error) {
    return {
      error: createGenericError(
        `Failed to process encryption key ${version}`,
        error
      ),
      data: null,
    };
  }
}

/**
 * Encrypts plaintext using AES-256-GCM with versioned keys.
 * @param {string} text - The plaintext string to encrypt.
 * @returns {Result<string>} Result containing the encrypted string with version prefix or an error.
 */
export function encrypt(text: string): Result<string> {
  const currentVersion = getCurrentKeyVersion();
  const keyResult = getEncryptionKey(currentVersion);
  if (keyResult.error) {
    return keyResult;
  }
  const key = keyResult.data;

  try {
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

    let encrypted = cipher.update(text, "utf8", ENCODING);
    encrypted += cipher.final(ENCODING);

    const authTag = cipher.getAuthTag();

    const resultString = [
      currentVersion,
      iv.toString(ENCODING),
      encrypted,
      authTag.toString(ENCODING),
    ].join(DELIMITER);

    return { error: null, data: resultString };
  } catch (error) {
    return {
      error: createGenericError("Encryption failed", error),
      data: null,
    };
  }
}

/**
 * Decrypts an encrypted string using AES-256-GCM with versioned keys.
 * @param {string} encryptedText - The encrypted string ('version:iv:encryptedData:authTag' hex format).
 * @returns {Result<string>} Result containing the original plaintext string or an error.
 */
export function decrypt(encryptedText: string): Result<string> {
  try {
    const parts = encryptedText.split(DELIMITER);
    if (parts.length !== 4) {
      return {
        error: createGenericError(
          "Invalid encrypted text format. Expected: version:iv:data:tag"
        ),
        data: null,
      };
    }

    const [version, ivHex, encryptedDataHex, authTagHex] = parts;

    if (!(version && ivHex && encryptedDataHex && authTagHex)) {
      return {
        error: createGenericError(
          "Invalid encrypted text format - missing parts."
        ),
        data: null,
      };
    }

    // Get the key for this specific version
    const keyResult = getEncryptionKey(version);
    if (keyResult.error) {
      return keyResult;
    }
    const key = keyResult.data;

    const iv = Buffer.from(ivHex, ENCODING);
    const encryptedData = Buffer.from(encryptedDataHex, ENCODING);
    const authTag = Buffer.from(authTagHex, ENCODING);

    if (iv.length !== IV_LENGTH) {
      return {
        error: createGenericError("Invalid IV length."),
        data: null,
      };
    }
    if (authTag.length !== AUTH_TAG_LENGTH) {
      return {
        error: createGenericError("Invalid authTag length."),
        data: null,
      };
    }

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    let decrypted = decipher.update(encryptedData, undefined, "utf8");
    decrypted += decipher.final("utf8");

    return { error: null, data: decrypted };
  } catch (error) {
    return {
      error: createGenericError(
        "Decryption failed. Data may be corrupt or key incorrect.",
        error
      ),
      data: null,
    };
  }
}

/**
 * Recursively encrypts all string values in a nested object/record
 * @param {Record<string, any>} record - The object to encrypt
 * @returns {Result<Record<string, any>>} Result containing encrypted object or error
 */
export function encryptRecord(
  record: Record<string, any>
): Result<Record<string, any>> {
  try {
    const encryptedRecord: Record<string, any> = {};

    for (const [key, value] of Object.entries(record)) {
      if (value === null || value === undefined) {
        encryptedRecord[key] = value;
      } else if (typeof value === "string") {
        const encryptResult = encrypt(value);
        if (encryptResult.error) {
          return encryptResult;
        }
        encryptedRecord[key] = encryptResult.data;
      } else if (typeof value === "object" && !Array.isArray(value)) {
        // Recursively encrypt nested objects
        const nestedResult = encryptRecord(value);
        if (nestedResult.error) {
          return nestedResult;
        }
        encryptedRecord[key] = nestedResult.data;
      } else if (Array.isArray(value)) {
        // Handle arrays - encrypt string elements, recursively handle object elements
        const encryptedArray: any[] = [];
        for (const item of value) {
          if (typeof item === "string") {
            const encryptResult = encrypt(item);
            if (encryptResult.error) {
              return encryptResult;
            }
            encryptedArray.push(encryptResult.data);
          } else if (typeof item === "object" && item !== null) {
            const nestedResult = encryptRecord(item);
            if (nestedResult.error) {
              return nestedResult;
            }
            encryptedArray.push(nestedResult.data);
          } else {
            encryptedArray.push(item);
          }
        }
        encryptedRecord[key] = encryptedArray;
      } else {
        // Keep primitive types (numbers, booleans) as-is
        encryptedRecord[key] = value;
      }
    }

    return { error: null, data: encryptedRecord };
  } catch (error) {
    return {
      error: createGenericError("Record encryption failed", error),
      data: null,
    };
  }
}

/**
 * Recursively decrypts all string values in a nested object/record
 * @param {Record<string, any>} encryptedRecord - The encrypted object to decrypt
 * @returns {Result<Record<string, any>>} Result containing decrypted object or error
 */
export function decryptRecord(
  encryptedRecord: Record<string, any>
): Result<Record<string, any>> {
  try {
    const decryptedRecord: Record<string, any> = {};

    for (const [key, value] of Object.entries(encryptedRecord)) {
      if (value === null || value === undefined) {
        decryptedRecord[key] = value;
      } else if (typeof value === "string") {
        const decryptResult = decrypt(value);
        if (decryptResult.error) {
          return {
            error: createGenericError(
              `Failed to decrypt field '${key}': ${decryptResult.error.message}`
            ),
            data: null,
          };
        }
        decryptedRecord[key] = decryptResult.data;
      } else if (typeof value === "object" && !Array.isArray(value)) {
        // Recursively decrypt nested objects
        const nestedResult = decryptRecord(value);
        if (nestedResult.error) {
          return nestedResult;
        }
        decryptedRecord[key] = nestedResult.data;
      } else if (Array.isArray(value)) {
        // Handle arrays - decrypt string elements, recursively handle object elements
        const decryptedArray: any[] = [];
        for (const item of value) {
          if (typeof item === "string") {
            const decryptResult = decrypt(item);
            if (decryptResult.error) {
              return {
                error: createGenericError(
                  `Failed to decrypt array item in field '${key}': ${decryptResult.error.message}`
                ),
                data: null,
              };
            }
            decryptedArray.push(decryptResult.data);
          } else if (typeof item === "object" && item !== null) {
            const nestedResult = decryptRecord(item);
            if (nestedResult.error) {
              return nestedResult;
            }
            decryptedArray.push(nestedResult.data);
          } else {
            decryptedArray.push(item);
          }
        }
        decryptedRecord[key] = decryptedArray;
      } else {
        // Keep primitive types (numbers, booleans) as-is
        decryptedRecord[key] = value;
      }
    }

    return { error: null, data: decryptedRecord };
  } catch (error) {
    return {
      error: createGenericError("Record decryption failed", error),
      data: null,
    };
  }
}
