import { env } from "@repo/api/env";
import pino from "pino";

export const logger = pino({
  transport:
    env.DEV === "true"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            minimumLevel: env.LOG_LEVEL,
          },
        }
      : undefined,
  level: env.LOG_LEVEL,
});
