import { createGenericError, type Result } from "@repo/api/utils";
import type { SecretConfig } from "better-auth/crypto";
import { symmetricDecrypt, symmetricEncrypt } from "better-auth/crypto";

const resolveKey = async (key?: SecretConfig): Promise<SecretConfig> => {
  if (key) {
    return key;
  }
  const { getAuthSecretConfig } = await import("./auth-secret-runtime");
  return getAuthSecretConfig();
};

/**
 * Encrypts plaintext with Better Auth symmetric encryption (`$ba$version$…`).
 */
export async function encrypt(
  text: string,
  key?: SecretConfig
): Promise<Result<string>> {
  try {
    const ciphertext = await symmetricEncrypt({
      data: text,
      key: await resolveKey(key),
    });
    return { error: null, data: ciphertext };
  } catch (error) {
    return {
      error: createGenericError("Encryption failed", error),
      data: null,
    };
  }
}

/**
 * Decrypts a Better Auth sealed string (`$ba$version$…`).
 */
export async function decrypt(
  encryptedText: string,
  key?: SecretConfig
): Promise<Result<string>> {
  try {
    const plaintext = await symmetricDecrypt({
      data: encryptedText,
      key: await resolveKey(key),
    });
    return { error: null, data: plaintext };
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
 * Recursively encrypts all string values in a nested object/record.
 */
export async function encryptRecord(
  record: Record<string, unknown>
): Promise<Result<Record<string, unknown>>> {
  try {
    const encryptedRecord: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
      if (value === null || value === undefined) {
        encryptedRecord[key] = value;
      } else if (typeof value === "string") {
        const encryptResult = await encrypt(value);
        if (encryptResult.error) {
          return encryptResult;
        }
        encryptedRecord[key] = encryptResult.data;
      } else if (typeof value === "object" && !Array.isArray(value)) {
        const nestedResult = await encryptRecord(
          value as Record<string, unknown>
        );
        if (nestedResult.error) {
          return nestedResult;
        }
        encryptedRecord[key] = nestedResult.data;
      } else if (Array.isArray(value)) {
        const encryptedArray: unknown[] = [];
        for (const item of value) {
          if (typeof item === "string") {
            const encryptResult = await encrypt(item);
            if (encryptResult.error) {
              return encryptResult;
            }
            encryptedArray.push(encryptResult.data);
          } else if (typeof item === "object" && item !== null) {
            const nestedResult = await encryptRecord(
              item as Record<string, unknown>
            );
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
 * Recursively decrypts all string values in a nested object/record.
 */
export async function decryptRecord(
  encryptedRecord: Record<string, unknown>
): Promise<Result<Record<string, unknown>>> {
  try {
    const decryptedRecord: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(encryptedRecord)) {
      if (value === null || value === undefined) {
        decryptedRecord[key] = value;
      } else if (typeof value === "string") {
        const decryptResult = await decrypt(value);
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
        const nestedResult = await decryptRecord(
          value as Record<string, unknown>
        );
        if (nestedResult.error) {
          return nestedResult;
        }
        decryptedRecord[key] = nestedResult.data;
      } else if (Array.isArray(value)) {
        const decryptedArray: unknown[] = [];
        for (const item of value) {
          if (typeof item === "string") {
            const decryptResult = await decrypt(item);
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
            const nestedResult = await decryptRecord(
              item as Record<string, unknown>
            );
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
