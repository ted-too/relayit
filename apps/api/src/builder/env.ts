import { type BuilderEnv, env as boundEnv } from "@repo/api/env";

/** Builder process env (packs already bound by `@repo/api/env`). */
export const env = boundEnv as BuilderEnv;
