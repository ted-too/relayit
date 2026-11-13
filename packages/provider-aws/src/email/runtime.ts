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
  ProviderRejected,
} from "@repo/channels/provider-errors";
import { Effect, Layer } from "effect";
import { awsSesProviderDefinition } from "../client";
import { awsCredentialsSchema } from "../credentials";
import { AwsUnexpectedResponseError, createAwsErrorMapper } from "../errors";
import { ensureSesDomainIdentity } from "./identity";
import { createAwsSesInfrastructure, SES_CONFIGURATION_SET_NAME } from "./infrastructure";
import {
  detachSesIdentityFromTenants,
  ensureSesTenant,
  isSesTenantPaused,
  sesTenantNameFor,
} from "./tenant";
import { createAwsSesWebhooks } from "./webhooks";

/** `${providerId}:${tenantName}:${fqdn}` already ensured by this process. */
const ensuredTenants = new Set<string>();

type CreateEmailProviderInput = Parameters<EmailProviderFactory["create"]>[0];

const parseAwsCredentials = (
  credentials: CreateEmailProviderInput["credentials"],
  context: ProviderInstanceErrorContext,
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
  context: ProviderInstanceErrorContext,
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
      }).pipe(Effect.provide(Layer.merge(SESv2.layer(config), SNS.layer(config)))),
    ),
  );

export const awsSesProviderFactory = {
  create: ({ credentials, providerId }) => {
    const context = {
      providerId,
      typeId: awsSesProviderDefinition.typeId,
    } satisfies ProviderInstanceErrorContext;
    const mapAwsError = createAwsErrorMapper(context);

    return createAwsEmailClients(credentials, context).pipe(
      Effect.map(({ region, ses, sns }) => {
        /**
         * Fail open: a tenant we could not ensure (e.g. IAM lacks
         * ses:CreateTenant) sends untenanted, as before tenants existed,
         * and is retried on the next send.
         */
        const ensureTenantForSend = (input: {
          readonly identityFqdn: string;
          readonly tenantName: string;
        }) => {
          const key = `${providerId}:${input.tenantName}:${input.identityFqdn}`;
          if (ensuredTenants.has(key)) {
            return Effect.succeed<string | undefined>(input.tenantName);
          }
          return ensureSesTenant(ses, { ...input, region }).pipe(
            Effect.map(() => {
              ensuredTenants.add(key);
              return input.tenantName as string | undefined;
            }),
            Effect.catch((cause) =>
              Effect.logWarning("Failed to ensure SES tenant; sending untenanted", {
                cause,
                identityFqdn: input.identityFqdn,
                providerId,
                tenantName: input.tenantName,
              }).pipe(Effect.as(undefined)),
            ),
          );
        };

        return {
          checkConnection: ses.getAccount({}).pipe(Effect.as(true), Effect.mapError(mapAwsError)),
          createIdentity: ({ dkimPrivateKey, dkimSelector, fqdn }) =>
            ensureSesDomainIdentity(ses, {
              dkimPrivateKey,
              dkimSelector,
              fqdn,
              region,
            }).pipe(Effect.mapError(mapAwsError)),
          definition: awsSesProviderDefinition,
          deleteIdentity: ({ fqdn }) =>
            Effect.gen(function* () {
              // Best effort: if this fails, deleteEmailIdentity below
              // surfaces the real error while associations remain.
              yield* detachSesIdentityFromTenants(ses, { fqdn, region }).pipe(
                Effect.catch((cause) =>
                  Effect.logWarning("Failed to detach SES identity from tenants", {
                    cause,
                    fqdn,
                    providerId,
                  }),
                ),
              );
              yield* ses
                .deleteEmailIdentity({ EmailIdentity: fqdn })
                .pipe(Effect.catchTags({ NotFoundException: () => Effect.void }));
            }).pipe(Effect.mapError(mapAwsError)),
          getIdentityStatus: ({ fqdn }) =>
            ses.getEmailIdentity({ EmailIdentity: fqdn }).pipe(
              Effect.map((identity) => ({
                dkimVerified: identity.DkimAttributes?.Status === "SUCCESS",
                verified: identity.VerifiedForSendingStatus === true,
              })),
              Effect.mapError(mapAwsError),
            ),
          infrastructure: createAwsSesInfrastructure({
            context,
            mapAwsError,
            ses,
            sns,
          }),
          send: (message) =>
            Effect.gen(function* () {
              const attachments = yield* Effect.forEach(message.attachments ?? [], (attachment) =>
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
                    ContentType: attachment.contentType ?? "application/octet-stream",
                    FileName: attachment.filename,
                    RawContent: Uint8Array.fromBase64(attachment.content),
                  }),
                }),
              );
              const tenantName = message.sender
                ? yield* ensureTenantForSend({
                    identityFqdn: message.sender.identityFqdn,
                    tenantName: sesTenantNameFor(message.sender.projectId),
                  })
                : undefined;
              const result = yield* ses
                .sendEmail({
                  ConfigurationSetName: SES_CONFIGURATION_SET_NAME,
                  TenantName: tenantName,
                  Content: {
                    Simple: {
                      Attachments: attachments.length > 0 ? attachments : undefined,
                      Body: {
                        Html: message.html ? { Charset: "UTF-8", Data: message.html } : undefined,
                        Text: message.text ? { Charset: "UTF-8", Data: message.text } : undefined,
                      },
                      Headers: Object.entries(message.headers ?? {}).map(([Name, Value]) => ({
                        Name,
                        Value,
                      })),
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
                })
                .pipe(
                  Effect.catchTags({
                    SendingPausedException: (error) =>
                      tenantName
                        ? isSesTenantPaused(ses, tenantName).pipe(
                            Effect.orElseSucceed(() => false),
                            Effect.flatMap((tenantPaused) =>
                              Effect.fail(
                                tenantPaused
                                  ? new ProviderRejected({
                                      ...context,
                                      cause: error,
                                      reason: "project_sending_paused",
                                    })
                                  : error,
                              ),
                            ),
                          )
                        : Effect.fail(error),
                  }),
                );
              if (!result.MessageId) {
                return yield* new AwsUnexpectedResponseError({
                  missingField: "MessageId",
                  operation: "SendEmail",
                });
              }
              return { providerMessageId: result.MessageId };
            }).pipe(Effect.mapError(mapAwsError)),
        } satisfies EmailProviderAdapter;
      }),
    );
  },
  definition: awsSesProviderDefinition,
  webhooks: createAwsSesWebhooks({ typeId: awsSesProviderDefinition.typeId }),
} satisfies EmailProviderFactory;
