import {
	PublishCommand,
	type PublishCommandInput,
	type PublishCommandOutput,
	SNSClient,
} from "@aws-sdk/client-sns";
import { decryptRecord } from "@repo/db";
import type {
	AWSProviderCredentials,
	ProjectProviderConfig,
	ProviderCredentials,
	Result,
	SMSPayload,
} from "@repo/shared";
import {
	awsCredentialsSchema,
	createGenericError,
	isAWSProviderCredentials,
	isSNSProjectProviderConfig,
	snsProjectProviderConfigSchema,
} from "@repo/shared";
import {
	BASE_RETRY_DELAY_MS,
	MAX_RETRY_ATTEMPTS,
} from "@repo/worker/lib/constants";
import { delay, logger } from "@repo/worker/lib/utils";
import type {
	INotificationProvider,
	ProviderSendResult,
} from "@repo/worker/providers/interface";

export class SNSProvider implements INotificationProvider {
	async send(
		encryptedCredentials: ProviderCredentials,
		messagePayload: SMSPayload,
		config: ProjectProviderConfig,
		recipient: string
	): Promise<Result<ProviderSendResult>> {
		const startTime = Date.now();

		// Create a structured context for this send operation
		const logContext: Record<string, any> = {
			provider: "sns",
			recipient,
			messageType: messagePayload.type,
		};

		logger.debug(logContext, "Starting SNS SMS send operation");

		if (!isAWSProviderCredentials(encryptedCredentials)) {
			logger.error(
				logContext,
				"Invalid SNS credentials structure (pre-decrypt)"
			);
			return {
				error: createGenericError(
					"Invalid SNS credentials structure (pre-decrypt)"
				),
				data: null,
			};
		}

		if (!isSNSProjectProviderConfig(config)) {
			logger.error(logContext, "Invalid SNS config structure");
			return {
				error: createGenericError("Invalid SNS config structure"),
				data: null,
			};
		}

		const configParseResult = snsProjectProviderConfigSchema.safeParse(config);
		if (!configParseResult.success) {
			logger.error(
				{ ...logContext, validationError: configParseResult.error },
				"Invalid SNS config content"
			);
			return {
				error: createGenericError(
					"Invalid SNS config content",
					configParseResult.error
				),
				data: null,
			};
		}

		const decryptResult =
			decryptRecord<AWSProviderCredentials>(encryptedCredentials);

		if (decryptResult.error) {
			logger.error(
				{ ...logContext, error: decryptResult.error },
				"Failed to decrypt SNS credentials"
			);
			return {
				error: createGenericError(
					"Failed to decrypt SNS credentials",
					decryptResult.error.details
				),
				data: null,
			};
		}

		const decryptedCreds = decryptResult.data;
		const parseResult = awsCredentialsSchema.safeParse(decryptedCreds);
		if (!parseResult.success) {
			logger.error(
				{ ...logContext, validationError: parseResult.error },
				"Invalid decrypted SNS credentials format"
			);
			return {
				error: createGenericError(
					"Invalid decrypted SNS credentials format",
					parseResult.error
				),
				data: null,
			};
		}
		const credentials = parseResult.data;

		// Add region to log context now that we have credentials
		logContext.region = credentials.unencrypted.region;

		const snsClient = new SNSClient({
			region: credentials.unencrypted.region,
			credentials: {
				accessKeyId: credentials.accessKeyId,
				secretAccessKey: credentials.secretAccessKey,
			},
		});

		const params: PublishCommandInput = {
			PhoneNumber: recipient,
			Message: messagePayload.body,
		};

		// Add optional SMS attributes if configured
		if (configParseResult.data.senderName) {
			params.MessageAttributes = {
				"AWS.SNS.SMS.SenderID": {
					DataType: "String",
					StringValue: configParseResult.data.senderName,
				},
			};
		}

		// Set SMS type from payload if provided (defaults to Promotional if not specified)
		if (messagePayload.smsType) {
			if (!params.MessageAttributes) {
				params.MessageAttributes = {};
			}
			params.MessageAttributes["AWS.SNS.SMS.SMSType"] = {
				DataType: "String",
				StringValue: messagePayload.smsType,
			};
		}

		let lastError: any = null;
		for (let attempt = 1; attempt <= MAX_RETRY_ATTEMPTS; attempt++) {
			const attemptStartTime = Date.now();

			try {
				const command = new PublishCommand(params);
				const data: PublishCommandOutput = await snsClient.send(command);

				const duration = Date.now() - startTime;
				logger.info(
					{
						...logContext,
						messageId: data.MessageId,
						attempt,
						duration,
						success: true,
					},
					"SNS SMS sent successfully"
				);

				return {
					error: null,
					data: {
						success: true,
						details: { messageId: data.MessageId },
					},
				};
			} catch (error: any) {
				lastError = error;
				const attemptDuration = Date.now() - attemptStartTime;

				const isRetryable =
					error.name === "ThrottlingException" ||
					error.name === "ServiceUnavailableException" ||
					(error.$metadata?.httpStatusCode &&
						error.$metadata.httpStatusCode >= 500);

				const errorContext = {
					...logContext,
					error: {
						name: error.name,
						message: error.message,
						code: error.code,
						statusCode: error.$metadata?.httpStatusCode,
					},
					attempt,
					maxAttempts: MAX_RETRY_ATTEMPTS,
					attemptDuration,
					isRetryable,
					isLastAttempt: attempt === MAX_RETRY_ATTEMPTS,
				};

				if (isRetryable && attempt < MAX_RETRY_ATTEMPTS) {
					const delayMs = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
					logger.warn(
						{ ...errorContext, retryDelayMs: delayMs },
						`SNS attempt ${attempt}/${MAX_RETRY_ATTEMPTS} failed, retrying in ${delayMs}ms`
					);
					await delay(delayMs);
				} else {
					logger.error(
						errorContext,
						`SNS attempt ${attempt}/${MAX_RETRY_ATTEMPTS} failed${isRetryable ? " (max attempts reached)" : " (non-retryable error)"}`
					);
					break;
				}
			}
		}

		const totalDuration = Date.now() - startTime;
		logger.error(
			{
				...logContext,
				totalDuration,
				totalAttempts: MAX_RETRY_ATTEMPTS,
				finalError: lastError
					? {
							name: lastError.name,
							message: lastError.message,
							code: lastError.code,
							statusCode: lastError.$metadata?.httpStatusCode,
						}
					: null,
			},
			`SNS SMS send failed after ${MAX_RETRY_ATTEMPTS} attempts`
		);

		return {
			error: createGenericError(
				`Failed to send SMS via SNS after ${MAX_RETRY_ATTEMPTS} attempt(s)`,
				lastError
			),
			data: null,
		};
	}
}
