import {
  assertCloudCloudflareEnv,
  assertCloudGitHubEnv,
  assertCloudStripeEnv,
  sharedEnvOptions,
  sharedServerEnvSchema,
} from "@repo/api/env";
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
    // Cloud edition only — docs SSO / shared cookie domain.
    DOCS_URL: z.url().optional(),
    // Cloud edition only — GitHub social login.
    GITHUB_CLIENT_ID: z.string().min(1).optional(),
    GITHUB_CLIENT_SECRET: z.string().min(1).optional(),
    // Cloud edition only (asserted below when EDITION=cloud).
    STRIPE_WEBHOOK_SECRET: z.string().min(1).optional(),
  },
  ...sharedEnvOptions,
});

assertCloudStripeEnv({
  STRIPE_WEBHOOK_SECRET: env.STRIPE_WEBHOOK_SECRET,
});
assertCloudCloudflareEnv();
assertCloudGitHubEnv({
  GITHUB_CLIENT_ID: env.GITHUB_CLIENT_ID,
  GITHUB_CLIENT_SECRET: env.GITHUB_CLIENT_SECRET,
});

export { IS_CLOUD_EDITION } from "@repo/api/env";
