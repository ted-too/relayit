import {
  SESClient,
  SendEmailCommand,
  type SendEmailCommandInput,
  type SendEmailCommandOutput,
} from "@aws-sdk/client-ses";
import { decryptRecord } from "@repo/shared/db/crypto";
import {
  channelIdentifierValidators,
  PROVIDER_CONFIG,
} from "@repo/shared/providers";
import { categorizeAWSError } from "@/providers/aws/errors";
import { PROVIDER_ERRORS } from "@/providers/errors";
import type { SendMethod } from "@/providers/interface";

export type SESResultDetails = {
  messageId: string;
  requestId: string;
};

const credentialsSchema = PROVIDER_CONFIG.aws.credentialsSchema;

export const sendSES: SendMethod<"email", SESResultDetails> = async ({
  to,
  payload,
  credentials,
  identity,
}) => {
  if (!(payload.html || payload.text)) {
    return {
      error: PROVIDER_ERRORS.NO_PAYLOAD_PROVIDED,
      data: null,
    };
  }

  const senderValidation = channelIdentifierValidators.email.safeParse(
    identity.identifier
  );
  if (!senderValidation.success) {
    return {
      error: {
        code: "INVALID_SENDER_EMAIL",
        message: `Invalid sender email format: ${identity.identifier}`,
        retryable: false,
      },
      data: null,
    };
  }

  const decryptResult = decryptRecord(credentials.credentials.encrypted);
  if (decryptResult.error) {
    return {
      error: {
        code: "CREDENTIAL_DECRYPT_FAILED",
        message: "Failed to decrypt AWS credentials",
        retryable: false,
      },
      data: null,
    };
  }
  
  // Combine decrypted encrypted fields with unencrypted fields
  const fullCredentials = {
    encrypted: decryptResult.data,
    unencrypted: credentials.credentials.unencrypted,
  };
  
  const credentialsValidation = credentialsSchema.safeParse(fullCredentials);
  if (!credentialsValidation.success) {
    return {
      error: {
        code: "INVALID_CREDENTIALS_FORMAT",
        message: "Invalid AWS credentials format",
        retryable: false,
      },
      data: null,
    };
  }

  const awsCredentials = credentialsValidation.data;
  const sesClient = new SESClient({
    region: awsCredentials.unencrypted.region,
    credentials: {
      accessKeyId: awsCredentials.encrypted.accessKeyId,
      secretAccessKey: awsCredentials.encrypted.secretAccessKey,
    },
  });
  const emailParams: SendEmailCommandInput = {
    Source: identity.identifier,
    Destination: { ToAddresses: [to] },
    Message: {
      Subject: { Data: payload.subject, Charset: "UTF-8" },
      Body: {
        ...(payload.html && { Html: { Data: payload.html, Charset: "UTF-8" } }),
        ...(payload.text && { Text: { Data: payload.text, Charset: "UTF-8" } }),
      },
    },
  };

  try {
    const command = new SendEmailCommand(emailParams);
    const result: SendEmailCommandOutput = await sesClient.send(command);

    return {
      error: null,
      data: {
        messageId: result.MessageId || "unknown",
        requestId: result.$metadata?.requestId || "unknown",
      },
    };
  } catch (error) {
    return {
      error: categorizeAWSError(error),
      data: null,
    };
  }
};
