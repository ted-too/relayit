import type { ChannelType } from "@repo/shared";
import type { INotificationProvider } from "@repo/worker/providers/interface";
import { SESProvider } from "@repo/worker/providers/ses";
// Import other providers like SNSProvider here when implemented

/**
 * Factory function to get the appropriate notification provider instance.
 *
 * @param channel The communication channel (e.g., 'email', 'sms').
 * @returns An instance of INotificationProvider for the given channel.
 * @throws {Error} If no provider is found for the channel.
 */
export function getProvider(channel: ChannelType): INotificationProvider {
	switch (channel) {
		case "email":
			return new SESProvider();
		// case "sms":
		// 	 return new SNSProvider(); // Example for future
		default:
			// Optional: Implement a fallback or logging for unsupported channels
			console.warn(`No provider implemented for channel: ${channel}`);
			throw new Error(`Unsupported channel type: ${channel}`);
	}
}
