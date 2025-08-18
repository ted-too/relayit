import type { FilterFn } from "@tanstack/react-table";
import { isAfter, isBefore, isSameDay } from "date-fns";

export function isArrayOfDates(arr: any): arr is Date[] {
	if (!Array.isArray(arr)) return false;
	return arr.every((item) => item instanceof Date);
}

export const inDateRange: FilterFn<any> = (row, columnId, value) => {
	const date = new Date(row.getValue(columnId));
	const [start, end] = value as Date[];

	if (Number.isNaN(date.getTime())) return false;

	// if no end date, check if it's the same day
	if (!end) return isSameDay(date, start);

	return isAfter(date, start) && isBefore(date, end);
};

inDateRange.autoRemove = (val: any) =>
	!Array.isArray(val) || !val.length || !isArrayOfDates(val);

export const arrSome: FilterFn<any> = (row, columnId, filterValue) => {
	if (!Array.isArray(filterValue)) return false;
	return filterValue.some((val) => row.getValue<unknown[]>(columnId) === val);
};

arrSome.autoRemove = (val: any) => !Array.isArray(val) || !val?.length;

export function isArrayOfNumbers(arr: any): arr is number[] {
	if (!Array.isArray(arr)) return false;
	return arr.every((item) => typeof item === "number");
}
