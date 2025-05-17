export const AVAILABLE_MESSAGE_STATUSES = [
	"queued",
	"processing",
	"sent",
	"failed",
	"delivered",
	"malformed",
] as const;

export type MessageStatus = (typeof AVAILABLE_MESSAGE_STATUSES)[number];
