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

export interface GenericError {
  details: string[];
  message: string;
}

export const createGenericError = (
  message: string,
  error?: Error | string[] | unknown
): GenericError => {
  let details: string[] = [];
  if (error) {
    if (Array.isArray(error)) {
      details = error;
    } else if (error instanceof Error) {
      details = [error.message];
    } else {
      details = [String(error)];
    }
  }

  return {
    message,
    details,
  };
};

export type Result<T> =
  | {
      error: null;
      data: T;
    }
  | {
      error: GenericError;
      data: null;
    };
