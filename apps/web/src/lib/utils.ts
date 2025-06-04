import { organizationMetadataSchema } from "@repo/shared";
import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
	return twMerge(clsx(inputs));
}

export function getInitials(name: string) {
	return name
		.split(" ")
		.map((n) => n[0].toUpperCase())
		.slice(0, 2)
		.join("");
}

export function getOrganizationMetadata(metadata: string | null) {
	if (!metadata) return null;

	const result = organizationMetadataSchema.safeParse(JSON.parse(metadata));

	if (!result.success) return null;

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
	},
): Partial<T> {
	const changes: Partial<T> = {};

	for (const key in current) {
		// Skip if key doesn't exist in both objects
		if (!(key in initial)) continue;

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

export function formatCompactNumber(value: number) {
	if (value >= 100 && value < 1000) {
		return value.toString(); // Keep the number as is if it's in the hundreds
	}
	if (value >= 1000 && value < 1000000) {
		return `${(value / 1000).toFixed(1)}k`; // Convert to 'k' for thousands
	}
	if (value >= 1000000) {
		return `${(value / 1000000).toFixed(1)}M`; // Convert to 'M' for millions
	}
	return value.toString(); // Optionally handle numbers less than 100 if needed
}

// export function isArrayOfNumbers(arr: any): arr is number[] {
// 	if (!Array.isArray(arr)) return false;
// 	return arr.every((item) => typeof item === "number");
// }

// export function isArrayOfDates(arr: any): arr is Date[] {
// 	if (!Array.isArray(arr)) return false;
// 	return arr.every((item) => item instanceof Date);
// }

// export function isArrayOfStrings(arr: any): arr is string[] {
// 	if (!Array.isArray(arr)) return false;
// 	return arr.every((item) => typeof item === "string");
// }

// export function isArrayOfBooleans(arr: any): arr is boolean[] {
// 	if (!Array.isArray(arr)) return false;
// 	return arr.every((item) => typeof item === "boolean");
// }

// export const inDateRange: FilterFn<any> = (row, columnId, value) => {
// 	const date = new Date(row.getValue(columnId));
// 	const [start, end] = value as Date[];

// 	if (Number.isNaN(date.getTime())) return false;

// 	// if no end date, check if it's the same day
// 	if (!end) return isSameDay(date, start);

// 	return isAfter(date, start) && isBefore(date, end);
// };

// inDateRange.autoRemove = (val: any) =>
// 	!Array.isArray(val) || !val.length || !isArrayOfDates(val);

// export const arrSome: FilterFn<any> = (row, columnId, filterValue) => {
// 	if (!Array.isArray(filterValue)) return false;
// 	return filterValue.some((val) => row.getValue<unknown[]>(columnId) === val);
// };

// arrSome.autoRemove = (val: any) => !Array.isArray(val) || !val?.length;
