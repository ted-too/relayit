import type { ChannelType } from "@repo/shared";
import type { INotificationProvider } from "@repo/worker/providers/interface";
import { SESProvider } from "@repo/worker/providers/ses";
import { SNSProvider } from "@repo/worker/providers/sns";
import { logger } from "@repo/worker/lib/utils";

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
		case "sms":
			return new SNSProvider();
		default:
			logger.warn(`No provider implemented for channel: ${channel}`);
			throw new Error(`Unsupported channel type: ${channel}`);
	}
}
