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
			"CREDENTIAL_ENCRYPTION_KEY environment variable is not set.",
		);
	}
	const key = Buffer.from(keyHex, ENCODING);
	if (key.length !== KEY_LENGTH) {
		throw new Error(
			`CREDENTIAL_ENCRYPTION_KEY must be ${KEY_LENGTH * 2} hex characters long.`,
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
		DELIMITER,
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
			"Failed to decrypt credentials. Data may be corrupt or key incorrect.",
		);
	}
}

/**
 * Encrypts each value in an object while keeping the keys intact.
 * Fields named 'unencrypted' and their descendants are left unencrypted.
 * @param {T} obj - The object to encrypt
 * @returns {T} A new object with encrypted values, maintaining the same type
 */
export function encryptRecord<T extends object>(obj: T): T {
	const encryptedObj = {} as T;

	for (const [key, value] of Object.entries(obj)) {
		if (key === "unencrypted") {
			encryptedObj[key as keyof T] = value;
			continue;
		}

		if (typeof value === "object" && value !== null) {
			encryptedObj[key as keyof T] = encryptRecord(value) as any;
		} else if (typeof value === "string") {
			encryptedObj[key as keyof T] = encrypt(value) as any;
		} else {
			encryptedObj[key as keyof T] = value;
		}
	}

	return encryptedObj;
}

/**
 * Decrypts each value in an object while keeping the keys intact.
 * Fields named 'unencrypted' and their descendants are left unencrypted.
 * @param {T} obj - The object to decrypt
 * @returns {T} A new object with decrypted values, maintaining the same type
 */
export function decryptRecord<T extends object>(obj: T): T {
	const decryptedObj = {} as T;

	for (const [key, value] of Object.entries(obj)) {
		if (key === "unencrypted") {
			decryptedObj[key as keyof T] = value;
			continue;
		}

		if (typeof value === "object" && value !== null) {
			decryptedObj[key as keyof T] = decryptRecord(value) as any;
		} else if (typeof value === "string") {
			decryptedObj[key as keyof T] = decrypt(value) as any;
		} else {
			decryptedObj[key as keyof T] = value;
		}
	}

	return decryptedObj;
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
	source: DeepPartial<T>,
): T {
	const updated = { ...target };

	for (const key in source) {
		// Skip if key doesn't exist in target
		if (!(key in target)) continue;

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
				sourceValue as DeepPartial<typeof targetValue>,
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
	source: DeepPartial<T>,
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
				sourceValue as DeepPartial<typeof targetValue>,
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
