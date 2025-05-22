import {
	SESClient,
	SendEmailCommand,
	type SendEmailCommandInput,
	type SendEmailCommandOutput,
} from "@aws-sdk/client-ses";
import { decryptRecord } from "@repo/db";
import type {
	AWSProviderCredentials,
	ProjectProviderConfig,
	ProviderCredentials,
	Result,
	SendMessagePayload,
} from "@repo/shared";
import {
	awsCredentialsSchema,
	createGenericError,
	isAWSProviderCredentials,
	isSESProjectProviderConfig,
	sesProjectProviderConfigSchema,
} from "@repo/shared";
import {
	BASE_RETRY_DELAY_MS,
	MAX_RETRY_ATTEMPTS,
} from "@repo/worker/lib/constants";
import { delay } from "@repo/worker/lib/utils";
import type {
	INotificationProvider,
	ProviderSendResult,
} from "@repo/worker/providers/interface";

export class SESProvider implements INotificationProvider {
	async send(
		encryptedCredentials: ProviderCredentials,
		messagePayload: SendMessagePayload,
		config: ProjectProviderConfig,
		recipient: string,
	): Promise<Result<ProviderSendResult>> {
		if (!isAWSProviderCredentials(encryptedCredentials)) {
			return {
				error: createGenericError(
					"Invalid SES credentials structure (pre-decrypt)",
				),
				data: null,
			};
		}

		if (!isSESProjectProviderConfig(config)) {
			return {
				error: createGenericError("Invalid SES config structure"),
				data: null,
			};
		}

		const configParseResult = sesProjectProviderConfigSchema.safeParse(config);
		if (!configParseResult.success) {
			return {
				error: createGenericError(
					"Invalid SES config content",
					configParseResult.error,
				),
				data: null,
			};
		}

		if (!messagePayload.subject) {
			return {
				error: createGenericError("Subject is required for SES"),
				data: null,
			};
		}

		const decryptResult =
			decryptRecord<AWSProviderCredentials>(encryptedCredentials);

		if (decryptResult.error) {
			return {
				error: createGenericError(
					"Failed to decrypt SES credentials",
					decryptResult.error.details,
				),
				data: null,
			};
		}
		const decryptedCreds = decryptResult.data;
		const parseResult = awsCredentialsSchema.safeParse(decryptedCreds);
		if (!parseResult.success) {
			return {
				error: createGenericError(
					"Invalid decrypted SES credentials format",
					parseResult.error,
				),
				data: null,
			};
		}
		const credentials = parseResult.data;

		const sesClient = new SESClient({
			region: credentials.unencrypted.region,
			credentials: {
				accessKeyId: credentials.accessKeyId,
				secretAccessKey: credentials.secretAccessKey,
			},
		});

		const params: SendEmailCommandInput = {
			Source: configParseResult.data.senderEmail,
			Destination: { ToAddresses: [recipient] },
			Message: {
				Subject: { Data: messagePayload.subject, Charset: "UTF-8" },
				Body:
					messagePayload.type === "html"
						? { Html: { Data: messagePayload.body, Charset: "UTF-8" } }
						: { Text: { Data: messagePayload.body, Charset: "UTF-8" } },
			},
		};

		let lastError: any = null;
		for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
			try {
				const command = new SendEmailCommand(params);
				const data: SendEmailCommandOutput = await sesClient.send(command);
				return {
					error: null,
					data: {
						success: true,
						details: { messageId: data.MessageId },
					},
				};
			} catch (error: any) {
				lastError = error;
				console.warn(
					`[SESProvider] Attempt ${attempt}/${MAX_RETRY_ATTEMPTS} failed for recipient ${recipient}: ${error.name} - ${error.message}`,
				);

				const isRetryable =
					error.name === "ThrottlingException" ||
					error.name === "ServiceUnavailableException" ||
					(error.$metadata?.httpStatusCode &&
						error.$metadata.httpStatusCode >= 500);

				if (isRetryable && attempt < MAX_RETRY_ATTEMPTS) {
					const delayMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
					console.log(`[SESProvider] Retrying in ${delayMs}ms...`);
					await delay(delayMs);
				} else {
					break;
				}
			}
		}

		return {
			error: createGenericError(
				`Failed to send email via SES after ${MAX_RETRY_ATTEMPTS} attempt(s)`,
				lastError,
			),
			data: null,
		};
	}
}
