import type { z } from "zod";
import { z as zod } from "zod";

/**
 * Parse a Zod object shape from `Bun.env`, treating empty strings as unset
 * (same behaviour as t3-env `emptyStringAsUndefined`).
 */
export function parseEnv<T extends z.ZodRawShape>(
  shape: T
): zod.infer<zod.ZodObject<T>> {
  const input: Record<string, unknown> = {};
  for (const key of Object.keys(shape)) {
    const raw = Bun.env[key];
    input[key] = raw === "" || raw === undefined ? undefined : raw;
  }
  return zod.object(shape).parse(input);
}
