import { organizationMetadataSchema } from "@repo/shared";

export function getOrganizationMetadata(metadata: string | null) {
	if (!metadata) {
		return null;
	}

	const result = organizationMetadataSchema.safeParse(JSON.parse(metadata));

	if (!result.success) {
		return null;
	}

	return result.data;
}

/**
 * Compares an object with its initial state and returns only the changed fields,
 * maintaining the original structure. Performs a deep comparison.
 * @param current The current object state
 * @param initial The initial object state to compare against
 * @param opts Options for controlling the comparison behavior
 * @param opts.alwaysKeep Fields that should always use the initial value
 * @returns An object containing only the fields that differ from initial state
 */
export function getChangedFields<T extends Record<string, any>>(
	current: T,
	initial: T,
	opts?: {
		alwaysKeep?: DeepPartialRecord<T, boolean>;
	}
): Partial<T> {
	const changes: Partial<T> = {};

	for (const key in current) {
		// Skip if key doesn't exist in both objects
		if (!(key in initial)) {
			continue;
		}

		const currentValue = current[key];
		const initialValue = initial[key];

		// Handle null/undefined cases
		if (currentValue === null || currentValue === undefined) {
			if (initialValue !== currentValue) {
				changes[key] = currentValue;
			}
			continue;
		}

		// Compare objects recursively
		if (
			typeof currentValue === "object" &&
			typeof initialValue === "object" &&
			!Array.isArray(currentValue) &&
			!Array.isArray(initialValue)
		) {
			const nestedChanges = getChangedFields(currentValue, initialValue);

			// Check if this field should always keep initial value
			const alwaysKeepValue = opts?.alwaysKeep?.[key];

			if (Object.keys(nestedChanges).length > 0) {
				// If field should be kept and has changes, use entire initial value
				if (alwaysKeepValue === true) {
					changes[key] = initialValue;
				} else if (typeof alwaysKeepValue === "object") {
					// If nested always keep config exists, pass it down
					changes[key] = getChangedFields(currentValue, initialValue, {
						alwaysKeep: alwaysKeepValue as DeepPartialRecord<
							typeof currentValue,
							boolean
						>,
					}) as T[keyof T];
				} else {
					changes[key] = nestedChanges as T[keyof T];
				}
			}
			continue;
		}

		// Check if this field should always keep initial value for primitive values
		const alwaysKeepValue = opts?.alwaysKeep?.[key];
		if (alwaysKeepValue === true) {
			changes[key] = initialValue;
			continue;
		}

		// Compare arrays and primitive values
		if (JSON.stringify(currentValue) !== JSON.stringify(initialValue)) {
			changes[key] = currentValue;
		}
	}

	return changes;
}

type DeepPartialRecord<T, V> = {
	[P in keyof T]?: T[P] extends object ? DeepPartialRecord<T[P], V> | V : V;
};
