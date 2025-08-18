import type { MessageStatus } from "@repo/shared";

export function getStatusColor(
	value: MessageStatus,
): Record<"text" | "bg" | "border", string> {
	switch (value) {
		case "queued":
			return {
				text: "text-yellow-500",
				bg: "bg-yellow-500/10",
				border: "border-yellow-500/20",
			};
		case "processing":
			return {
				text: "text-blue-500",
				bg: "bg-blue-500/10", 
				border: "border-blue-500/20",
			};
		case "sent":
			return {
				text: "text-purple-500",
				bg: "bg-purple-500/10",
				border: "border-purple-500/20",
			};
		case "failed":
			return {
				text: "text-red-500",
				bg: "bg-red-500/10",
				border: "border-red-500/20",
			};
		case "delivered":
			return {
				text: "text-green-500",
				bg: "bg-green-500/10",
				border: "border-green-500/20",
			};
		case "malformed":
			return {
				text: "text-orange-500",
				bg: "bg-orange-500/10",
				border: "border-orange-500/20",
			};
		default:
			return {
				text: "text-gray-500",
				bg: "bg-gray-500/10",
				border: "border-gray-500/20",
			};
	}
}
