import type { BasePaginationParsers } from "@/components/tables/parsers";
import { zodKeys } from "@repo/shared";
import { useQueryStates } from "nuqs";

export function useTableSearchParams<T, R extends BasePaginationParsers>(
	schema: T,
	parsers: R,
) {
	// @ts-expect-error - we need to fix this fn
	const filterKeys = zodKeys(schema);

	const [search, _setSearch] = useQueryStates(parsers);

	const setSearch = (value: Partial<Parameters<typeof _setSearch>[0]>) => {
		_setSearch({ ...search, ...value });
	};

	return {
		search,
		filterKeys,
		setSearch,
	};
}
