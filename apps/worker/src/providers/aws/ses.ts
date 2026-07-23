import {
  SESClient,
  SendEmailCommand,
  type SendEmailCommandInput,
  type SendEmailCommandOutput,
  SendRawEmailCommand,
  type SendRawEmailCommandOutput,
} from "@aws-sdk/client-ses";
import { decryptRecord } from "@repo/shared/db/crypto";
import {
  channelIdentifierValidators,
  PROVIDER_CONFIG,
  type StoredAttachment,
} from "@repo/shared/providers";
import { createBunnyAttachmentStorage } from "@repo/shared/storage";
import MailComposer from "nodemailer/lib/mail-composer";
import { env } from "@/env";
import { formatEmailIdentity } from "@/lib/email-utils";
import { categorizeAWSError } from "@/providers/aws/errors";
import { PROVIDER_ERRORS } from "@/providers/errors";
import type { SendMethod } from "@/providers/interface";

export type SESResultDetails = {
  messageId: string;
  requestId: string;
};

const credentialsSchema = PROVIDER_CONFIG.aws.credentialsSchema;

function getBunnyStorage() {
  return createBunnyAttachmentStorage({
    endpoint: env.BUNNY_S3_ENDPOINT,
    region: env.BUNNY_S3_REGION,
    accessKeyId: env.BUNNY_S3_ACCESS_KEY_ID,
    secretAccessKey: env.BUNNY_S3_SECRET_ACCESS_KEY,
    bucket: env.BUNNY_S3_BUCKET,
  });
}

async function loadAttachmentBodies(attachments: StoredAttachment[]) {
  const storage = getBunnyStorage();

  const results = await Promise.all(
    attachments.map(async (attachment) => {
      const result = await storage.get(attachment.storageKey);
      return { attachment, result };
    })
  );

  const failed = results.find(({ result }) => result.error);
  if (failed?.result.error) {
    return {
      error: {
        code: "ATTACHMENT_FETCH_FAILED",
        message: failed.result.error.message,
        retryable: true,
      } as const,
      data: null,
    };
  }

  return {
    error: null,
    data: results.map(({ attachment, result }) => {
      if (result.error || !result.data) {
        throw new Error("Unexpected missing attachment body after validation");
      }
      return {
        filename: attachment.filename,
        contentType: attachment.contentType,
        contentId: attachment.contentId,
        content: result.data.body,
      };
    }),
  } as const;
}

async function buildRawMimeMessage(params: {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  attachments: Array<{
    filename: string;
    contentType: string;
    contentId?: string;
    content: Buffer;
  }>;
}): Promise<Buffer> {
  const mail = new MailComposer({
    from: params.from,
    to: params.to,
    subject: params.subject,
    html: params.html,
    text: params.text,
    attachments: params.attachments.map((attachment) => ({
      filename: attachment.filename,
      content: attachment.content,
      contentType: attachment.contentType,
      ...(attachment.contentId
        ? {
            cid: attachment.contentId,
            contentDisposition: "inline" as const,
          }
        : {}),
    })),
  });

  return await mail.compile().build();
}

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

  const from = formatEmailIdentity(identity);
  const hasAttachments = Boolean(payload.attachments?.length);

  try {
    if (hasAttachments && payload.attachments) {
      const loaded = await loadAttachmentBodies(payload.attachments);
      if (loaded.error) {
        return { error: loaded.error, data: null };
      }

      const rawMessage = await buildRawMimeMessage({
        from,
        to,
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        attachments: loaded.data,
      });

      const result: SendRawEmailCommandOutput = await sesClient.send(
        new SendRawEmailCommand({
          Source: from,
          Destinations: [to],
          RawMessage: { Data: rawMessage },
        })
      );

      return {
        error: null,
        data: {
          messageId: result.MessageId || "unknown",
          requestId: result.$metadata?.requestId || "unknown",
        },
      };
    }

    const emailParams: SendEmailCommandInput = {
      Source: from,
      Destination: { ToAddresses: [to] },
      Message: {
        Subject: { Data: payload.subject, Charset: "UTF-8" },
        Body: {
          ...(payload.html && {
            Html: { Data: payload.html, Charset: "UTF-8" },
          }),
          ...(payload.text && {
            Text: { Data: payload.text, Charset: "UTF-8" },
          }),
        },
      },
    };

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
