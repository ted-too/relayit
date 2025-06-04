import { isArrayOfDates } from "@/lib/utils";
import {
	ARRAY_DELIMITER,
	RANGE_DELIMITER,
	SLIDER_DELIMITER,
} from "@repo/shared";
import { z } from "zod/v4";
import type { DataTableFilterField } from "@/components/data-table/types";

/**
 * Deserializes a string input into an object using the provided schema
 */
export function deserialize<T extends z.AnyZodObject>(schema: T) {
	// The schema already handles conversion of strings to arrays via preprocess,
	// so we just need to parse the input into key-value pairs
	const castToSchema = z.preprocess((val) => {
		if (typeof val !== "string") return val;

		// Parse the input string into key-value pairs
		const parsedInput = val
			.trim()
			.split(" ")
			.reduce(
				(prev, curr) => {
					const [name, value] = curr.split(":");
					if (!value || !name) return prev;

					// Skip timestamp fields completely
					if (name === "timestamp") return prev;

					// Handle range values
					if (value.includes(RANGE_DELIMITER)) {
						prev[name] = value.split(RANGE_DELIMITER);
					} else {
						// Regular value - the schema will handle array coercion
						prev[name] = value;
					}

					return prev;
				},
				{} as Record<string, unknown>,
			);

		return parsedInput;
	}, schema);

	return (value: string) => {
		const result = castToSchema.safeParse(value);
		if (!result.success) {
			// Debug logging
			console.error("Schema validation failed:", result.error.message);
		}
		return result;
	};
}

/**
 * Serializes search params object to a command string format
 */
export function serializeSearchParams<TData>(
	searchParams: Record<string, unknown>,
	filterFields?: DataTableFilterField<TData>[],
) {
	return Object.entries(searchParams).reduce((prev, [key, value]) => {
		// Skip empty values and special keys
		if (
			value === undefined ||
			value === null ||
			key === "start" ||
			key === "end" ||
			key === "sort" ||
			key === "id" ||
			key === "tail" ||
			key === "interval" ||
			key === "timestamp" // Explicitly exclude timestamp
		) {
			return prev;
		}

		const field = filterFields?.find((field) => field.value === key);

		// Skip command disabled fields
		if (field?.commandDisabled) return prev;

		// Handle array values - using the appropriate delimiter based on field type
		if (Array.isArray(value)) {
			if (field?.type === "slider") {
				return `${prev}${key}:${value.join(SLIDER_DELIMITER)} `;
			}
			if (field?.type === "timerange") {
				return `${prev}${key}:${value.join(RANGE_DELIMITER)} `;
			}
			// Default array handling with ARRAY_DELIMITER for all other array types
			return `${prev}${key}:${value.join(ARRAY_DELIMITER)} `;
		}

		// Regular value
		return `${prev}${key}:${value} `;
	}, "");
}

/**
 * Extracts the word from the given string at the specified caret position.
 */
export function getWordByCaretPosition({
	value,
	caretPosition,
}: {
	value: string;
	caretPosition: number;
}) {
	let start = caretPosition;
	let end = caretPosition;

	while (start > 0 && value[start - 1] !== " ") start--;
	while (end < value.length && value[end] !== " ") end++;

	const word = value.substring(start, end);
	return word;
}

/**
 * Replaces part of the input string based on field type and delimiter
 */
export function replaceInputByFieldType<TData>({
	prev,
	currentWord,
	optionValue,
	value,
	field,
}: {
	prev: string;
	currentWord: string;
	optionValue?: string | number | boolean | undefined;
	value: string;
	field: DataTableFilterField<TData>;
}) {
	switch (field.type) {
		case "checkbox": {
			if (currentWord.includes(ARRAY_DELIMITER)) {
				const words = currentWord.split(ARRAY_DELIMITER);
				words[words.length - 1] = `${optionValue}`;
				const input = prev.replace(currentWord, words.join(ARRAY_DELIMITER));
				return `${input.trim()} `;
			}
			const input = prev.replace(currentWord, value);
			return `${input.trim()} `;
		}
		case "slider": {
			if (currentWord.includes(SLIDER_DELIMITER)) {
				const words = currentWord.split(SLIDER_DELIMITER);
				words[words.length - 1] = `${optionValue}`;
				const input = prev.replace(currentWord, words.join(SLIDER_DELIMITER));
				return `${input.trim()} `;
			}
			const input = prev.replace(currentWord, value);
			return `${input.trim()} `;
		}
		case "timerange": {
			if (currentWord.includes(RANGE_DELIMITER)) {
				const words = currentWord.split(RANGE_DELIMITER);
				words[words.length - 1] = `${optionValue}`;
				const input = prev.replace(currentWord, words.join(RANGE_DELIMITER));
				return `${input.trim()} `;
			}
			const input = prev.replace(currentWord, value);
			return `${input.trim()} `;
		}
		default: {
			const input = prev.replace(currentWord, value);
			return `${input.trim()} `;
		}
	}
}

/**
 * Gets the options for a field based on its type
 */
export function getFieldOptions<TData>({
	field,
}: {
	field: DataTableFilterField<TData>;
}) {
	switch (field.type) {
		case "slider": {
			return field.options?.length
				? field.options
						.map(({ value }) => value)
						.sort((a, b) => Number(a) - Number(b))
						.filter(notEmpty)
				: Array.from(
						{ length: field.max - field.min + 1 },
						(_, i) => field.min + i,
					) || [];
		}
		default: {
			return field.options?.map(({ value }) => value).filter(notEmpty) || [];
		}
	}
}

/**
 * Calculates a filter value score for command matching
 */
export function getFilterValue({
	value,
	search,
	currentWord,
}: {
	value: string;
	search: string;
	keywords?: string[] | undefined;
	currentWord: string;
}): number {
	// Handle suggestion items
	if (value.startsWith("suggestion:")) {
		const rawValue = value.toLowerCase().replace("suggestion:", "");
		if (rawValue.includes(search)) return 1;
		return 0;
	}

	// Direct word match
	if (value.toLowerCase().includes(currentWord.toLowerCase())) return 1;

	// Handle field:value syntax
	const [filter, query] = currentWord.toLowerCase().split(":");
	if (query && value.startsWith(`${filter}:`)) {
		if (query.includes(ARRAY_DELIMITER)) {
			// Handle array values (e.g. "regions:ams,gru,fra")
			const queries = query.split(ARRAY_DELIMITER);
			const rawValue = value.toLowerCase().replace(`${filter}:`, "");
			if (
				queries.some((item, i) => item === rawValue && i !== queries.length - 1)
			)
				return 0;
			if (queries.some((item) => rawValue.includes(item))) return 1;
		}
		if (query.includes(SLIDER_DELIMITER)) {
			// Handle range values (e.g. "p95:0-3000")
			const queries = query.split(SLIDER_DELIMITER);
			const rawValue = value.toLowerCase().replace(`${filter}:`, "");

			const rawValueAsNumber = Number.parseInt(rawValue);
			const queryAsNumber = Number.parseInt(queries[0]);

			if (queryAsNumber < rawValueAsNumber) {
				if (rawValue.includes(queries[1])) return 1;
				return 0;
			}
			return 0;
		}
		const rawValue = value.toLowerCase().replace(`${filter}:`, "");
		if (rawValue.includes(query)) return 1;
	}
	return 0;
}

/**
 * Formats a value based on field type for use in search params
 */
export function getFieldValueByType<TData>({
	field,
	value,
}: {
	field?: DataTableFilterField<TData>;
	value: unknown;
}) {
	if (!field) return null;

	// Regular field type handling
	switch (field.type) {
		case "slider": {
			if (Array.isArray(value)) {
				return value.join(SLIDER_DELIMITER);
			}
			return value;
		}
		case "checkbox": {
			// Return array as-is since the schema handles conversion
			return value;
		}
		case "timerange": {
			if (Array.isArray(value)) {
				if (isArrayOfDates(value)) {
					return value.map((date) => date.getTime()).join(RANGE_DELIMITER);
				}
				return value.join(RANGE_DELIMITER);
			}
			if (value instanceof Date) {
				return value.getTime();
			}
			return value;
		}
		default: {
			return value;
		}
	}
}

/**
 * Type guard for non-null values
 */
export function notEmpty<TValue>(
	value: TValue | null | undefined,
): value is TValue {
	return value !== null && value !== undefined;
}
