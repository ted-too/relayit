import type { DatabaseTransaction } from "@repo/persistence/db/effect";
import { type SQLWrapper, sql } from "drizzle-orm";

/**
 * Whether `name` is `root` or a name under it, ignoring case: what a Sandbox Domain's root
 * keeps from custom Domains, and what a custom Domain keeps a Sandbox Domain's root from.
 * Either side may be a column or a value.
 */
export const isAtOrUnderRoot = (name: SQLWrapper | string, root: SQLWrapper | string) =>
  // `right`, not `like`: an underscore in a name is a wildcard to `like`.
  sql`(lower(${name}) = lower(${root}) or right(lower(${name}), length(${root}::text) + 1) = '.' || lower(${root}))`;

/**
 * Orders the two refusals `isAtOrUnderRoot` makes, held to the end of the transaction. Each
 * side reads the other's rows and then writes its own, so without it an add in the instant a
 * Sandbox Domain is first set up passes both. Setting up a Sandbox Domain takes it
 * `exclusive`; a new custom Domain takes it `shared`, so adds never wait on each other. One
 * lock for every root, not one per name: the refusal covers the names under a root too.
 */
export const lockSandboxRoots = (tx: DatabaseTransaction, mode: "exclusive" | "shared") =>
  tx.execute(
    mode === "exclusive"
      ? sql`select pg_advisory_xact_lock(hashtextextended('sandbox-domain-roots', 0))`
      : sql`select pg_advisory_xact_lock_shared(hashtextextended('sandbox-domain-roots', 0))`,
  );
