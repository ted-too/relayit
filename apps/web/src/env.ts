import { createEnv } from "@t3-oss/env-core";
import * as z from "zod";

export const env = createEnv({
  server: {
    PORT: z.coerce.number().int().positive().optional(),
    HOST: z.string().optional(),
    /** Product edition — server-only; exposed to the client via root route context. */
    EDITION: z.enum(["oss", "cloud"]).optional().default("oss"),
  },
  clientPrefix: "VITE_",
  client: {
    VITE_DEBUG: z
      .enum(["true", "false"])
      .optional()
      .default("false")
      .transform((val) => val === "true"),
    VITE_API_URL: z.string().min(1),
    VITE_BASE_URL: z.string().min(1),
  },
  runtimeEnv: {
    PORT: process.env.PORT,
    HOST: process.env.HOST,
    EDITION: process.env.EDITION,
    VITE_DEBUG: import.meta.env.VITE_DEBUG,
    VITE_API_URL: import.meta.env.VITE_API_URL,
    VITE_BASE_URL: import.meta.env.VITE_BASE_URL,
  },
  emptyStringAsUndefined: true,
});

export type Env = typeof env;
