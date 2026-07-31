import {
  assertCloudCloudflareEnv,
  assertCloudStripeEnv,
  sharedEnvOptions,
  sharedServerEnvSchema,
} from "@repo/api/env";
import { createEnv } from "@t3-oss/env-core";
import { typeid } from "typeid-js";
import { z } from "zod";

export const env = createEnv({
  server: {
    ...sharedServerEnvSchema,
    WORKER_CONSUMER_NAME: z
      .string()
      .optional()
      .default(() => typeid("wkr").toString()),
  },
  ...sharedEnvOptions,
});

assertCloudStripeEnv();
assertCloudCloudflareEnv();

export { IS_CLOUD_EDITION } from "@repo/api/env";
