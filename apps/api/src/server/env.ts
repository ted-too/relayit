import { sharedEnvOptions, sharedServerEnvSchema } from "@repo/api/env";
import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
  server: {
    ...sharedServerEnvSchema,
    PORT: z.number().int().positive().optional().default(3005),
    API_URL: z.url(),
    APP_URL: z.url(),
    DOCS_URL: z.url().optional(),
    BETTER_AUTH_SECRET: z.string().min(1),
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
    ENABLE_DOCS: z.enum(["true", "false"]).optional().default("false"),
  },
  ...sharedEnvOptions,
});
