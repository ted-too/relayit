import crypto from "node:crypto";
import { createGenericError, type Result } from "@repo/shared";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // Recommended for GCM
const AUTH_TAG_LENGTH = 16; // GCM standard auth tag length
const KEY_LENGTH = 32; // For AES-256
const ENCODING = "hex";
const DELIMITER = ":";

/**
 * Retrieves the encryption key from environment variables.
 * Returns a Result object containing the key or an error.
 * @returns {Result<Buffer>} The encryption key as a Buffer or an error.
 */
function getEncryptionKey(): Result<Buffer> {
	try {
		const keyHex = process.env.CREDENTIAL_ENCRYPTION_KEY;
		if (!keyHex) {
			return {
				error: createGenericError(
					"CREDENTIAL_ENCRYPTION_KEY environment variable is not set."
				),
				data: null,
			};
		}
		const key = Buffer.from(keyHex, ENCODING);
		if (key.length !== KEY_LENGTH) {
			return {
				error: createGenericError(
					`CREDENTIAL_ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters long.`
				),
				data: null,
			};
		}
		return { error: null, data: key };
	} catch (error) {
		return {
			error: createGenericError("Failed to process encryption key", error),
			data: null,
		};
	}
}

/**
 * Encrypts plaintext using AES-256-GCM.
 * @param {string} text - The plaintext string to encrypt.
 * @returns {Result<string>} Result containing the encrypted string or an error.
 */
export function encrypt(text: string): Result<string> {
	const keyResult = getEncryptionKey();
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
 * Decrypts an encrypted string using AES-256-GCM.
 * @param {string} encryptedText - The encrypted string ('iv:encryptedData:authTag' hex format).
 * @returns {Result<string>} Result containing the original plaintext string or an error.
 */
export function decrypt(encryptedText: string): Result<string> {
	const keyResult = getEncryptionKey();
	if (keyResult.error) {
		return keyResult;
	}
	const key = keyResult.data;

	try {
		const parts = encryptedText.split(DELIMITER);
		if (parts.length !== 3) {
			return {
				error: createGenericError("Invalid encrypted text format."),
				data: null,
			};
		}

		const [ivHex, encryptedDataHex, authTagHex] = parts;

		const iv = Buffer.from(ivHex!, ENCODING);
		const encryptedData = Buffer.from(encryptedDataHex!, ENCODING);
		const authTag = Buffer.from(authTagHex!, ENCODING);

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
 * Encrypts each value in an object while keeping the keys intact.
 * Fields named 'unencrypted' and their descendants are left unencrypted.
 * If any encryption fails, it returns the first encountered error.
 * @param {T} obj - The object to encrypt.
 * @returns {Result<T>} A new object with encrypted values, or an error.
 */
export function encryptRecord<T extends object>(obj: T): Result<T> {
	const encryptedObj = {} as T;

	try {
		for (const [key, value] of Object.entries(obj)) {
			if (key === "unencrypted") {
				encryptedObj[key as keyof T] = value;
				continue;
			}

			if (typeof value === "object" && value !== null) {
				const nestedResult = encryptRecord(value as object);
				if (nestedResult.error) {
					return nestedResult;
				}
				encryptedObj[key as keyof T] = nestedResult.data as any;
			} else if (typeof value === "string") {
				const encryptedResult = encrypt(value);
				if (encryptedResult.error) {
					return { ...encryptedResult, data: null };
				}
				encryptedObj[key as keyof T] = encryptedResult.data as any;
			} else {
				encryptedObj[key as keyof T] = value;
			}
		}
		return { error: null, data: encryptedObj };
	} catch (error) {
		return {
			error: createGenericError(
				"Unexpected error during record encryption",
				error
			),
			data: null,
		};
	}
}

/**
 * Decrypts each value in an object while keeping the keys intact.
 * Fields named 'unencrypted' and their descendants are left unencrypted.
 * If any decryption fails, it returns the first encountered error.
 * @param {T} obj - The object to decrypt.
 * @returns {Result<T>} A new object with decrypted values, or an error.
 */
export function decryptRecord<T extends object>(obj: T): Result<T> {
	const decryptedObj = {} as T;

	try {
		for (const [key, value] of Object.entries(obj)) {
			if (key === "unencrypted") {
				decryptedObj[key as keyof T] = value;
				continue;
			}

			if (typeof value === "object" && value !== null) {
				const nestedResult = decryptRecord(value as object);
				if (nestedResult.error) {
					return nestedResult;
				}
				decryptedObj[key as keyof T] = nestedResult.data as any;
			} else if (typeof value === "string") {
				const decryptedResult = decrypt(value);
				if (decryptedResult.error) {
					return { ...decryptedResult, data: null };
				}
				decryptedObj[key as keyof T] = decryptedResult.data as any;
			} else {
				decryptedObj[key as keyof T] = value;
			}
		}
		return { error: null, data: decryptedObj };
	} catch (error) {
		return {
			error: createGenericError(
				"Unexpected error during record decryption",
				error
			),
			data: null,
		};
	}
}

export const redactedString = "•".repeat(8);

/**
 * Creates a safe version of an encrypted record by redacting the encrypted values.
 * Useful for logging or displaying sensitive data.
 * @param {T} record - The record with encrypted values
 * @returns {T} A new record with redacted values
 */
export function getSafeEncryptedRecord<T extends object>(record: T): T {
	const safeRecord = {} as T;

	for (const [key, value] of Object.entries(record)) {
		if (key === "unencrypted") {
			safeRecord[key as keyof T] = value;
			continue;
		}

		if (typeof value === "object" && value !== null) {
			safeRecord[key as keyof T] = getSafeEncryptedRecord(value) as any;
		} else if (typeof value === "string") {
			safeRecord[key as keyof T] = redactedString as any;
		} else {
			safeRecord[key as keyof T] = value;
		}
	}

	return safeRecord;
}

/**
 * Performs a deep update of a target object with values from a source object.
 * Only updates fields that exist in both objects, maintaining the original structure.
 * @param target The object to update
 * @param source The object containing update values
 * @returns The updated target object
 */
export function deepUpdate<T extends Record<string, any>>(
	target: T,
	source: DeepPartial<T>
): T {
	const updated = { ...target };

	for (const key in source) {
		// Skip if key doesn't exist in target
		if (!(key in target)) {
			continue;
		}

		const sourceValue = source[key];
		const targetValue = target[key];

		// Handle null/undefined cases
		if (sourceValue === null || sourceValue === undefined) {
			// Skip null/undefined values to maintain target type
			continue;
		}

		// Recursively update nested objects
		if (
			typeof sourceValue === "object" &&
			typeof targetValue === "object" &&
			!Array.isArray(sourceValue) &&
			!Array.isArray(targetValue)
		) {
			updated[key] = deepUpdate(
				targetValue,
				sourceValue as DeepPartial<typeof targetValue>
			);
			continue;
		}

		// Update arrays and primitive values
		updated[key] = sourceValue as T[Extract<keyof T, string>];
	}

	return updated;
}

/**
 * Performs a deep merge of two objects, combining their properties recursively.
 * Arrays are concatenated, objects are merged deeply, and primitive values from source override target.
 * @param target The base object to merge into
 * @param source The object whose properties will be merged into target
 * @returns A new object containing the merged properties
 */
export function deepMerge<T extends Record<string, any>>(
	target: T,
	source: DeepPartial<T>
): T {
	const merged = { ...target };

	for (const key in source) {
		const sourceValue = source[key];
		const targetValue = target[key];

		// Skip undefined values
		if (sourceValue === undefined) {
			continue;
		}

		// Handle null case
		if (sourceValue === null) {
			merged[key] = sourceValue as T[Extract<keyof T, string>];
			continue;
		}

		// Handle arrays - concatenate them
		if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
			merged[key] = [...targetValue, ...sourceValue] as T[Extract<
				keyof T,
				string
			>];
			continue;
		}

		// Recursively merge objects
		if (
			typeof sourceValue === "object" &&
			typeof targetValue === "object" &&
			!Array.isArray(sourceValue) &&
			!Array.isArray(targetValue)
		) {
			merged[key] = deepMerge(
				targetValue,
				sourceValue as DeepPartial<typeof targetValue>
			);
			continue;
		}

		// For all other cases (primitives), source value overrides target
		merged[key] = sourceValue as T[Extract<keyof T, string>];
	}

	return merged;
}

type DeepPartial<T> = {
	[P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};
