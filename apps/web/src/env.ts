import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  server: {},
  clientPrefix: "VITE_",
  client: {
    VITE_DEBUG: z
      .enum(["true", "false"])
      .optional()
      .default("false")
      .transform((val) => val === "true"),
    VITE_API_URL: z.string().min(1),
    VITE_BASE_URL: z.string().min(1),
    VITE_EDITION: z.enum(["oss", "cloud"]).optional().default("oss"),
  },
  runtimeEnv: import.meta.env,
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
