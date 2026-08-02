import {
  type ApiEnv,
  env as boundEnv,
  IS_CLOUD_EDITION,
} from "@repo/api/env";

/** API / combined HTTP process env (packs already bound by `@repo/api/env`). */
export const env = boundEnv as ApiEnv;

export { IS_CLOUD_EDITION };
