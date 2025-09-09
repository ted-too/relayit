export type FacetRow = {
  value: string | number | boolean;
  total: number;
};

export type FacetMetadata = {
  rows: FacetRow[];
  total: number;
  min?: number;
  max?: number;
};

export type Facets = Record<string, FacetMetadata>;

/**
 * Get facets from data
 * @param data - The data to get facets from
 * @param filterValues - The values to filter by
 * @returns The facets
 */
export function getFacetsFromData<TData extends Record<string, unknown>>(
  data: TData[],
  filterValues: string[]
) {
  const valuesMap = data.reduce((prev, curr) => {
    for (const [key, value] of Object.entries(curr)) {
      if (filterValues.includes(key as any)) {
        const _value = Array.isArray(value) ? value.toString() : value;
        const total = prev.get(key)?.get(_value) || 0;
        if (prev.has(key) && _value) {
          prev.get(key)?.set(_value, total + 1);
        } else if (_value) {
          prev.set(key, new Map([[_value, 1]]));
        }
      }
    }
    return prev;
  }, new Map<string, Map<any, number>>());

  const facets = Object.fromEntries(
    Array.from(valuesMap.entries()).map(([key, valueMap]) => {
      let min: number | undefined;
      let max: number | undefined;
      const rows = Array.from(valueMap.entries()).map(([value, total]) => {
        if (typeof value === "number") {
          if (min) {
            min = value < min ? value : min;
          } else {
            min = value;
          }
          if (max) {
            max = value > max ? value : max;
          } else {
            max = value;
          }
        }
        return {
          value,
          total,
        };
      });
      const total = Array.from(valueMap.values()).reduce((a, b) => a + b, 0);
      return [key, { rows, total, min, max }];
    })
  );

  return facets satisfies Facets;
}
