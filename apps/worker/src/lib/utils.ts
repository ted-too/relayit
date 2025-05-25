import pino from "pino";

// Helper for delay
export const delay = (ms: number) =>
	new Promise((resolve) => setTimeout(resolve, ms));

const logLevel = process.env.PINO_LOG_LEVEL || "info";

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
