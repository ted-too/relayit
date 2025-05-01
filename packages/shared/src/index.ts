export * from "./constants/core";
export * from "./constants/organization";

export * from "./validations/providers";
export * from "./validations/webhooks";
export * from "./validations/project";
export * from "./validations/send";
export * from "./validations/auth";

export function stringifyObject<T extends Record<string, unknown>>(
	obj?: T,
): { [K in keyof T]: string | string[] | undefined } {
	if (!obj) return {} as any;

	const result: { [K in keyof T]: string | string[] | undefined } = {} as any;

	for (const [key, value] of Object.entries(obj)) {
		if (value === undefined || value === null) {
			result[key as keyof T] = undefined;
		} else if (Array.isArray(value)) {
			result[key as keyof T] = value.map((item) =>
				item instanceof Date ? item.toISOString() : String(item),
			);
		} else if (value instanceof Date) {
			result[key as keyof T] = value.toISOString();
		} else {
			result[key as keyof T] = String(value);
		}
	}

	return result;
}
