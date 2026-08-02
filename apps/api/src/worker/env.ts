import {
  env as boundEnv,
  IS_CLOUD_EDITION,
  type WorkerEnv,
} from "@repo/api/env";

/** Worker process env (packs already bound by `@repo/api/env`). */
export const env = boundEnv as WorkerEnv;

export { IS_CLOUD_EDITION };
