import {
  assertCloudCloudflareEnv,
  assertCloudStripeEnv,
  sharedEnvOptions,
  sharedServerEnvSchema,
} from "@repo/api/env";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    ...sharedServerEnvSchema,
    PORT: z.coerce.number().int().positive().optional().default(3015),
    HOST: z.string().optional().default("0.0.0.0"),
    TEMPLATING_BUILDER_SECRET: z.string().min(1).optional(),
  },
  ...sharedEnvOptions,
});

assertCloudStripeEnv();
assertCloudCloudflareEnv();
