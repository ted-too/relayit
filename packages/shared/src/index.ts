export * from "./constants/core";
export * from "./constants/organization";

export * from "./validations/core";
export * from "./validations/project";
export * from "./validations/send";
export * from "./validations/auth";

export function stringifyObject<T extends Record<string, unknown>>(
	obj: T,
): Record<string, string | string[] | undefined> {
	const result: Record<string, string | string[] | undefined> = {};

	for (const [key, value] of Object.entries(obj)) {
		if (value === undefined || value === null) {
			result[key] = undefined;
		} else if (Array.isArray(value)) {
			result[key] = value.map((item) =>
				item instanceof Date ? item.toISOString() : String(item),
			);
		} else if (value instanceof Date) {
			result[key] = value.toISOString();
		} else {
			result[key] = String(value);
		}
	}

	return result;
}
