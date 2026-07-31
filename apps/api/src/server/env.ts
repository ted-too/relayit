import { sharedEnvOptions, sharedServerEnvSchema } from "@repo/api/env";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    ...sharedServerEnvSchema,
    REQUEST_LOGGING_ENABLED: z
      .enum(["true", "false"])
      .optional()
      .default("false"),
    PORT: z.coerce.number().int().positive().optional().default(3005),
    HOST: z.string().optional().default("0.0.0.0"),
    APP_URL: z.url(),
    DOCS_URL: z.url().optional(),
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
    ENABLE_DOCS: z.enum(["true", "false"]).optional().default("false"),
    STRIPE_WEBHOOK_SECRET: z.string().min(1),
  },
  ...sharedEnvOptions,
});

export { IS_CLOUD_EDITION } from "@repo/api/env";
