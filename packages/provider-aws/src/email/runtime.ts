import { SESv2 } from "@effect-aws/client-sesv2";
import { SNS } from "@effect-aws/client-sns";
import type {
  EmailProviderAdapter,
  EmailProviderFactory,
} from "@repo/channels/email/provider-adapter";
import type { ProviderInstanceErrorContext } from "@repo/channels/provider-errors";
import {
  ProviderConfigurationError,
  ProviderMessageError,
} from "@repo/channels/provider-errors";
import { Effect, Layer } from "effect";
import { awsSesProviderDefinition } from "../client";
import { awsCredentialsSchema } from "../credentials";
import {
  AwsUnexpectedResponseError,
  createAwsErrorMapper,
  createAwsWebhookErrorMapper,
} from "../errors";
import { ensureSesDomainIdentity } from "./identity";
import {
  createAwsSesInfrastructure,
  SES_CONFIGURATION_SET_NAME,
} from "./infrastructure";
import { createAwsSesWebhooks } from "./webhooks";

type CreateEmailProviderInput = Parameters<EmailProviderFactory["create"]>[0];

const parseAwsCredentials = (
  credentials: CreateEmailProviderInput["credentials"],
  context: ProviderInstanceErrorContext
) =>
  Effect.try({
    catch: (error) =>
      new ProviderConfigurationError({
        ...context,
        cause: error,
        code: "invalid_credentials",
      }),
    try: () => awsCredentialsSchema.parse(credentials),
  });

export const createAwsEmailClients = (
  credentials: CreateEmailProviderInput["credentials"],
  context: ProviderInstanceErrorContext
) =>
  parseAwsCredentials(credentials, context).pipe(
    Effect.map((aws) => ({
      credentials: {
        accessKeyId: aws.encrypted.accessKeyId,
        secretAccessKey: aws.encrypted.secretAccessKey,
      },
      region: aws.unencrypted.region,
    })),
    Effect.flatMap((config) =>
      Effect.gen(function* () {
        const ses = yield* SESv2;
        const sns = yield* SNS;

        return {
          region: config.region,
          ses,
          sns,
        };
      }).pipe(
        Effect.provide(Layer.merge(SESv2.layer(config), SNS.layer(config)))
      )
    )
  );

export const awsSesProviderFactory = {
  create: ({ credentials, providerId }) => {
    const context = {
      providerId,
      typeId: awsSesProviderDefinition.typeId,
    } satisfies ProviderInstanceErrorContext;
    const mapAwsError = createAwsErrorMapper(context);

    return createAwsEmailClients(credentials, context).pipe(
      Effect.map(
        ({ region, ses, sns }) =>
          ({
            checkConnection: ses
              .getAccount({})
              .pipe(Effect.as(true), Effect.mapError(mapAwsError)),
            createIdentity: ({ dkimPrivateKey, dkimSelector, fqdn }) =>
              ensureSesDomainIdentity(ses, {
                dkimPrivateKey,
                dkimSelector,
                fqdn,
                region,
              }).pipe(Effect.mapError(mapAwsError)),
            definition: awsSesProviderDefinition,
            deleteIdentity: ({ fqdn }) =>
              ses.deleteEmailIdentity({ EmailIdentity: fqdn }).pipe(
                Effect.catchTag("NotFoundException", () => Effect.void),
                Effect.mapError(mapAwsError)
              ),
            getIdentityStatus: ({ fqdn }) =>
              ses.getEmailIdentity({ EmailIdentity: fqdn }).pipe(
                Effect.map((identity) => ({
                  dkimVerified: identity.DkimAttributes?.Status === "SUCCESS",
                  verified: identity.VerifiedForSendingStatus === true,
                })),
                Effect.mapError(mapAwsError)
              ),
            infrastructure: createAwsSesInfrastructure({
              context,
              mapAwsError,
              ses,
              sns,
            }),
            send: (message) =>
              Effect.gen(function* () {
                const attachments = yield* Effect.forEach(
                  message.attachments ?? [],
                  (attachment) =>
                    Effect.try({
                      catch: (cause) =>
                        new ProviderMessageError({
                          ...context,
                          cause,
                          code: "invalid_attachment_encoding",
                          filename: attachment.filename,
                        }),
                      try: () => ({
                        ContentDisposition: attachment.contentId
                          ? ("INLINE" as const)
                          : ("ATTACHMENT" as const),
                        ContentId: attachment.contentId,
                        ContentTransferEncoding: "BASE64" as const,
                        ContentType:
                          attachment.contentType ?? "application/octet-stream",
                        FileName: attachment.filename,
                        RawContent: Uint8Array.fromBase64(attachment.content),
                      }),
                    })
                );
                const result = yield* ses.sendEmail({
                  ConfigurationSetName: SES_CONFIGURATION_SET_NAME,
                  Content: {
                    Simple: {
                      Attachments:
                        attachments.length > 0 ? attachments : undefined,
                      Body: {
                        Html: message.html
                          ? { Charset: "UTF-8", Data: message.html }
                          : undefined,
                        Text: message.text
                          ? { Charset: "UTF-8", Data: message.text }
                          : undefined,
                      },
                      Headers: Object.entries(message.headers ?? {}).map(
                        ([Name, Value]) => ({ Name, Value })
                      ),
                      Subject: { Charset: "UTF-8", Data: message.subject },
                    },
                  },
                  Destination: {
                    BccAddresses: message.bcc ?? undefined,
                    CcAddresses: message.cc ?? undefined,
                    ToAddresses: message.to,
                  },
                  FromEmailAddress: message.from.normalized,
                  ReplyToAddresses: message.replyTo ?? undefined,
                });
                if (!result.MessageId) {
                  return yield* new AwsUnexpectedResponseError({
                    missingField: "MessageId",
                    operation: "SendEmail",
                  });
                }
                return { providerMessageId: result.MessageId };
              }).pipe(Effect.mapError(mapAwsError)),
          }) satisfies EmailProviderAdapter
      )
    );
  },
  definition: awsSesProviderDefinition,
  webhooks: createAwsSesWebhooks(
    createAwsWebhookErrorMapper({
      typeId: awsSesProviderDefinition.typeId,
    })
  ),
} satisfies EmailProviderFactory;
