import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core";
import { Cause } from "effect";
import { isSqlError, type SqlError } from "effect/unstable/sql/SqlError";

const sqlErrorFromQueryError = (
  error: EffectDrizzleQueryError
): SqlError | null => {
  if (isSqlError(error.cause)) {
    return error.cause;
  }

  if (Cause.isCause(error.cause)) {
    const squashed = Cause.squash(error.cause);
    return isSqlError(squashed) ? squashed : null;
  }

  return null;
};

const uniqueViolationConstraint = (
  error: EffectDrizzleQueryError
): string | null => {
  const sqlError = sqlErrorFromQueryError(error);
  return sqlError?.reason._tag === "UniqueViolation"
    ? sqlError.reason.constraint
    : null;
};

export const remapUniqueViolation =
  <A>(map: Record<string, A>) =>
  (error: EffectDrizzleQueryError): A | EffectDrizzleQueryError => {
    const constraint = uniqueViolationConstraint(error);
    return constraint === null ? error : (map[constraint] ?? error);
  };
