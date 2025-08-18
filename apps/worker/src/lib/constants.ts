import { typeid } from "typeid-js";

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
	1000
); // Start with 1 second

export const CONSUMER_GROUP_NAME = getEnvAsString(
	"WORKER_CONSUMER_GROUP_NAME",
	"message_consumers"
);
export const CONSUMER_NAME = getEnvAsString(
	"WORKER_CONSUMER_NAME",
	typeid("worker").toString()
);
export const BLOCK_TIMEOUT_MS = getEnvAsInt("WORKER_BLOCK_TIMEOUT_MS", 5000); // How long to block on XREADGROUP (milliseconds)
export const READ_COUNT = getEnvAsInt("WORKER_READ_COUNT", 10); // How many messages to attempt to read at once

// Pending message recovery settings
// How long a message must be idle before it can be claimed (5 minutes)
export const MIN_IDLE_TIME_MS = getEnvAsInt(
	"WORKER_MIN_IDLE_TIME_MS",
	5 * 60 * 1000
);

// How often to check for pending messages (30 seconds)
export const PENDING_CHECK_INTERVAL_MS = getEnvAsInt(
	"WORKER_PENDING_CHECK_INTERVAL_MS",
	30 * 1000
);

// Maximum number of pending messages to claim at once
export const MAX_CLAIM_COUNT = getEnvAsInt("WORKER_MAX_CLAIM_COUNT", 5);
