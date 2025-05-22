import type {
	ProjectProviderConfig,
	ProviderCredentials,
	Result,
	SendMessagePayload,
} from "@repo/shared";

/**
 * Represents the outcome of a provider's send operation.
 */
export interface ProviderSendResult {
	success: boolean;
	details?: any; // Provider-specific details (e.g., external message ID)
}

/**
 * Defines the contract for all notification provider implementations.
 */
export interface INotificationProvider {
	/**
	 * Sends a message using the provider's specific API.
	 *
	 * @param credentials The credentials required by the provider.
	 * @param messagePayload The provider-specific payload for the message.
	 * @param recipient The target recipient (e.g., email address, phone number).
	 * @returns A promise resolving to a ProviderSendResult.
	 */
	send(
		credentials: ProviderCredentials,
		messagePayload: SendMessagePayload,
		config: ProjectProviderConfig,
		recipient: string,
	): Promise<Result<ProviderSendResult>>;
}
