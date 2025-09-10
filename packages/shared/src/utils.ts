import pino from "pino";

export type GenericError = {
  message: string;
  details: string[];
};

export const createGenericError = (
  message: string,
  error?: Error | string[] | unknown
): GenericError => ({
  message,
  details: error
    ? Array.isArray(error)
      ? error
      : [error instanceof Error ? error.message : String(error)]
    : [],
});

export type Result<T> =
  | {
      error: null;
      data: T;
    }
  | {
      error: GenericError;
      data: null;
    };

const logLevel = process.env.LOG_LEVEL || "info";

export const logger = pino({
  transport:
    process.env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            minimumLevel: logLevel,
          },
        }
      : undefined,
  level: logLevel,
});
