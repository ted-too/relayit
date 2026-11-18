import { type SQLWrapper, sql } from "drizzle-orm";

/**
 * Whether `name` is `root` or a name under it, ignoring case: what a Sandbox Domain's root
 * keeps from custom Domains, and what a custom Domain keeps a Sandbox Domain's root from.
 * Either side may be a column or a value.
 */
export const isAtOrUnderRoot = (name: SQLWrapper | string, root: SQLWrapper | string) =>
  // `right`, not `like`: an underscore in a name is a wildcard to `like`.
  sql`(lower(${name}) = lower(${root}) or right(lower(${name}), length(${root}::text) + 1) = '.' || lower(${root}))`;
