import type { Facets } from "@repo/shared";
import type { Table as TTable } from "@tanstack/react-table";

export function getFacetedUniqueValues<TData>(facets?: Facets) {
	return (_: TTable<TData>, columnId: string): Map<string, number> => {
		return new Map(
			facets?.[columnId]?.rows?.map(({ value, total }) => [
				value.toString(),
				total,
			]) || []
		);
	};
}

export function getFacetedMinMaxValues<TData>(facets?: Facets) {
	return (_: TTable<TData>, columnId: string): [number, number] | undefined => {
		const min = facets?.[columnId]?.min;
		const max = facets?.[columnId]?.max;
		if (min && max) {
			return [min, max];
		}
		if (min) {
			return [min, min];
		}
		if (max) {
			return [max, max];
		}
		return;
	};
}

export function combineFacets(facets: Facets[]): Facets {
	// If no facets provided, return empty object
	if (!facets.length) {
		return {};
	}

	// Combine all facet keys
	const allKeys = new Set(facets.flatMap((f) => Object.keys(f)));

	return Array.from(allKeys).reduce((combined, key) => {
		const relevantFacets = facets.filter((f) => key in f).map((f) => f[key]);

		if (!relevantFacets.length) {
			return combined;
		}

		// Combine rows by merging value maps
		const valueMap = new Map<any, number>();
		let min: number | undefined;
		let max: number | undefined;

		for (const facet of relevantFacets) {
			for (const row of facet.rows) {
				const currentTotal = valueMap.get(row.value) || 0;
				valueMap.set(row.value, currentTotal + row.total);

				if (typeof row.value === "number") {
					if (!min || row.value < min) {
						min = row.value;
					}
					if (!max || row.value > max) {
						max = row.value;
					}
				}
			}
		}

		const rows = Array.from(valueMap.entries()).map(([value, total]) => ({
			value,
			total,
		}));

		const total = Array.from(valueMap.values()).reduce((a, b) => a + b, 0);

		combined[key] = {
			rows,
			total,
			min,
			max,
		};

		return combined;
	}, {} as Facets);
}
