import type z from "zod/v4";

// get zod object keys recursively
export const zodKeys = <T extends z.ZodType>(schema: T): string[] => {
	// FIXME: Make this work
	// make sure schema is not null or undefined
	// if (schema === null || schema === undefined) return [];
	// // check if schema is nullable or optional
	// if (schema instanceof z.ZodNullable || schema instanceof z.ZodOptional)
	// 	return zodKeys(schema.);
	// // check if schema is an array
	// if (schema instanceof z.ZodArray) return zodKeys(schema.element);
	// // check if schema is an object
	// if (schema instanceof z.ZodObject) {
	// 	// get key/value pairs from schema
	// 	const entries = Object.entries(schema.shape);
	// 	// loop through key/value pairs
	// 	return entries.flatMap(([key, value]) => {
	// 		// get nested keys
	// 		const nested =
	// 			value instanceof z.ZodType
	// 				? zodKeys(value).map((subKey) => `${key}.${subKey}`)
	// 				: [];
	// 		// return nested keys
	// 		return nested.length ? nested : key;
	// 	});
	// }
	// return empty array
	return [];
};

export const ARRAY_DELIMITER = ",";
export const SLIDER_DELIMITER = "-";
export const SPACE_DELIMITER = "_";
export const RANGE_DELIMITER = "-";
export const SORT_DELIMITER = ".";
