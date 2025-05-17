// Helper function to get an environment variable as a number or use a default
const getEnvAsInt = (name: string, defaultValue: number): number => {
	const value = process.env[name];
	if (value === undefined || value === null || value.trim() === "") {
		return defaultValue;
	}
	const parsed = Number.parseInt(value, 10);
	return Number.isNaN(parsed) ? defaultValue : parsed;
};

// Helper function to get an environment variable as a string or use a default
const getEnvAsString = (name: string, defaultValue: string): string => {
	return process.env[name] || defaultValue;
};

export const MAX_RETRY_ATTEMPTS = getEnvAsInt("WORKER_MAX_RETRY_ATTEMPTS", 3);
export const BASE_RETRY_DELAY_MS = getEnvAsInt(
	"WORKER_BASE_RETRY_DELAY_MS",
	1000,
); // Start with 1 second

export const CONSUMER_GROUP_NAME = getEnvAsString(
	"WORKER_CONSUMER_GROUP_NAME",
	"message_consumers",
);
export const CONSUMER_NAME = getEnvAsString(
	"WORKER_CONSUMER_NAME",
	`worker_consumer_${crypto.randomUUID()}`,
);
export const BLOCK_TIMEOUT_MS = getEnvAsInt("WORKER_BLOCK_TIMEOUT_MS", 5000); // How long to block on XREADGROUP (milliseconds)
export const READ_COUNT = getEnvAsInt("WORKER_READ_COUNT", 10); // How many messages to attempt to read at once
