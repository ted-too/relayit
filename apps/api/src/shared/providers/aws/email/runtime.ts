import {
  CreateEmailIdentityCommand,
  DeleteEmailIdentityCommand,
  GetAccountCommand,
  GetEmailIdentityCommand,
  PutEmailIdentityMailFromAttributesCommand,
  SendEmailCommand,
} from "@aws-sdk/client-sesv2";
import { buildRuntimeEmailRegistryConfig } from "@repo/api/channels/email/providers/registry";
import { formatTxtRecordContent } from "@repo/api/channels/email/sending-identity/dns";
import { createGenericError } from "@repo/api/utils";
import { SES_CLIENT_CONFIG } from "./client";
import { awsSesRegion, buildSesClient } from "./clients";
import {
  ensureSesEventNotifications,
  handleSesWebhook,
  SES_CONFIGURATION_SET_NAME,
  teardownSesEventNotifications,
} from "./webhooks";

export const SES_RUNTIME_CONFIG = buildRuntimeEmailRegistryConfig({
  clientConfig: SES_CLIENT_CONFIG,
  async createIdentity({ credentials, fqdn, dkimSelector, dkimPrivateKey }) {
    const client = buildSesClient(credentials);

    try {
      await client.send(
        new CreateEmailIdentityCommand({
          EmailIdentity: fqdn,
          DkimSigningAttributes: {
            DomainSigningSelector: dkimSelector,
            DomainSigningPrivateKey: dkimPrivateKey,
          },
        })
      );
    } catch (error) {
      // The identity can be left behind in SES if a prior create succeeded here
      // but a later DB step rolled back. Adopt the existing identity instead of
      // failing so re-adding the domain is idempotent.
      if ((error as { name?: string }).name !== "AlreadyExistsException") {
        throw error;
      }
    }

    const mailFromDomain = `send.${fqdn}`;

    await client.send(
      new PutEmailIdentityMailFromAttributesCommand({
        EmailIdentity: fqdn,
        MailFromDomain: mailFromDomain,
        BehaviorOnMxFailure: "USE_DEFAULT_VALUE",
      })
    );

    const region = awsSesRegion(credentials);
    const mxValue = `feedback-smtp.${region}.amazonses.com`;

    const providerData = SES_CLIENT_CONFIG.domainConfigSchema.parse({
      dkimSelector,
    });

    return {
      providerData,
      mailFrom: {
        domain: mailFromDomain,
        records: [
          {
            purpose: "mail_from_mx" as const,
            recordType: "MX" as const,
            name: mailFromDomain,
            value: mxValue,
            priority: 10,
          },
          {
            purpose: "mail_from_spf" as const,
            recordType: "TXT" as const,
            name: mailFromDomain,
            value: formatTxtRecordContent("v=spf1 include:amazonses.com ~all"),
          },
        ],
      },
    };
  },

  async getIdentityStatus({ credentials, fqdn }) {
    const client = buildSesClient(credentials);

    const identity = await client.send(
      new GetEmailIdentityCommand({ EmailIdentity: fqdn })
    );

    const verified = identity.VerifiedForSendingStatus === true;
    const dkimVerified = identity.DkimAttributes?.Status === "SUCCESS";

    return { verified, dkimVerified };
  },

  async deleteIdentity({ credentials, fqdn }) {
    const client = buildSesClient(credentials);
    try {
      await client.send(
        new DeleteEmailIdentityCommand({ EmailIdentity: fqdn })
      );
    } catch (error) {
      // Idempotent teardown: an already-absent identity is a successful delete.
      if ((error as { name?: string }).name !== "NotFoundException") {
        throw error;
      }
    }
  },

  async checkConnection({ credentials }) {
    try {
      const client = buildSesClient(credentials);
      await client.send(new GetAccountCommand({}));
      return { ok: true };
    } catch {
      return { ok: false };
    }
  },

  send: {
    async raw({ credentials, message }) {
      try {
        const client = buildSesClient(credentials);

        const result = await client.send(
          new SendEmailCommand({
            FromEmailAddress: message.from.normalized,
            ConfigurationSetName: SES_CONFIGURATION_SET_NAME,
            ReplyToAddresses: message.reply_to,
            Destination: {
              ToAddresses: message.to.map(({ email }) => email),
              BccAddresses: message.bcc?.map(({ email }) => email),
              CcAddresses: message.cc?.map(({ email }) => email),
            },
            Content: {
              Simple: {
                Subject: {
                  Data: message.subject,
                  Charset: "UTF-8",
                },
                Body: {
                  ...(message.html
                    ? {
                        Html: {
                          Data: message.html,
                          Charset: "UTF-8" as const,
                        },
                      }
                    : {}),
                  ...(message.text
                    ? {
                        Text: {
                          Data: message.text,
                          Charset: "UTF-8" as const,
                        },
                      }
                    : {}),
                },
                ...(message.headers
                  ? {
                      Headers: Object.entries(message.headers).map(
                        ([Name, Value]) => ({ Name, Value })
                      ),
                    }
                  : {}),
                Attachments: message.attachments?.map((attachment) => ({
                  FileName: attachment.filename,
                  RawContent: Uint8Array.from(
                    Buffer.from(attachment.content, "base64")
                  ),
                  ...("content_id" in attachment
                    ? {
                        ContentDisposition: "INLINE",
                        ContentId: attachment.content_id,
                      }
                    : {
                        ContentDisposition: "ATTACHMENT",
                      }),
                  ContentTransferEncoding: "BASE64" as const,
                })),
              },
            },
          })
        );

        if (!result.MessageId) {
          return {
            data: null,
            error: createGenericError(
              "SES did not return a message id for the send request"
            ),
          };
        }

        return { data: { messageId: result.MessageId }, error: null };
      } catch (error) {
        return {
          data: null,
          error: createGenericError("Failed to send email via SES", error),
        };
      }
    },
  },

  webhooks: {
    ensureNotifications: ensureSesEventNotifications,
    teardownNotifications: teardownSesEventNotifications,
    handle: handleSesWebhook,
  },
});
