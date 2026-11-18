import { SESv2 } from "@effect-aws/client-sesv2";
import { SNS } from "@effect-aws/client-sns";
import {
  EmailBackendConfigurationError,
  EmailBackendMessageError,
  EmailBackendRejected,
  type EmailBackendService,
} from "@repo/channels/email/backend";
import { Effect, Layer } from "effect";
import { AwsUnexpectedResponseError, createAwsErrorMapper } from "../errors";
import { ensureSesDomainIdentity } from "./identity";
import { ensureSesInfrastructure, SES_CONFIGURATION_SET_NAME } from "./infrastructure";
import {
  detachSesIdentityFromTenants,
  ensureSesTenant,
  isSesTenantPaused,
  sesTenantNameFor,
} from "./tenant";

export interface SesConfig {
  readonly accessKeyId: string;
  /** `SES_REGIONS`, the first the default for new Domains. */
  readonly regions: readonly [string, ...string[]];
  readonly secretAccessKey: string;
}

/** `${region}:${tenantName}:${fqdn}` already ensured by this process. */
const ensuredTenants = new Set<string>();

const clientsFor = (config: SesConfig, region: string) =>
  Effect.gen(function* () {
    return { ses: yield* SESv2, sns: yield* SNS };
  }).pipe(
    Effect.provide(
      Layer.merge(
        SESv2.layer({ credentials: config, region }),
        SNS.layer({ credentials: config, region }),
      ),
    ),
  );

/** The deployment's SES account, one set of clients per configured region. */
export const makeSesEmailBackend = (config: SesConfig) =>
  Effect.gen(function* () {
    const clients = new Map(
      yield* Effect.forEach(config.regions, (region) =>
        clientsFor(config, region).pipe(Effect.map((pair) => [region, pair] as const)),
      ),
    );
    const defaultRegion = config.regions[0];

    /** A registration with no recorded region predates regions: it is in the default one. */
    const inRegion = (recorded: string | null) => {
      const region = recorded ?? defaultRegion;
      const pair = clients.get(region);
      return pair
        ? Effect.succeed({ ...pair, mapAwsError: createAwsErrorMapper({ region }), region })
        : Effect.fail(new EmailBackendConfigurationError({ code: "unknown_region", region }));
    };

    /**
     * Fail open: a tenant we could not ensure (e.g. IAM lacks ses:CreateTenant) sends
     * untenanted, as before tenants existed, and is retried on the next send.
     */
    const ensureTenantForSend = (
      ses: SESv2.Type,
      input: {
        readonly identityFqdn: string;
        readonly region: string;
        readonly tenantName: string;
      },
    ) => {
      const key = `${input.region}:${input.tenantName}:${input.identityFqdn}`;
      if (ensuredTenants.has(key)) {
        return Effect.succeed<string | undefined>(input.tenantName);
      }
      return ensureSesTenant(ses, input).pipe(
        Effect.map(() => {
          ensuredTenants.add(key);
          return input.tenantName as string | undefined;
        }),
        Effect.catch((cause) =>
          Effect.logWarning("Failed to ensure SES tenant; sending untenanted", {
            cause,
            identityFqdn: input.identityFqdn,
            region: input.region,
            tenantName: input.tenantName,
          }).pipe(Effect.as(undefined)),
        ),
      );
    };

    return {
      createIdentity: ({ dkimPrivateKey, dkimSelector, fqdn, region: recorded }) =>
        Effect.gen(function* () {
          const { mapAwsError, region, ses } = yield* inRegion(recorded);
          return yield* ensureSesDomainIdentity(ses, {
            dkimPrivateKey,
            dkimSelector,
            fqdn,
            region,
          }).pipe(Effect.mapError(mapAwsError));
        }),
      defaultRegion,
      deleteIdentity: ({ fqdn, region: recorded }) =>
        Effect.gen(function* () {
          const { mapAwsError, region, ses } = yield* inRegion(recorded);
          // Best effort: if this fails, deleteEmailIdentity below surfaces the real error
          // while associations remain.
          yield* detachSesIdentityFromTenants(ses, { fqdn, region }).pipe(
            Effect.catch((cause) =>
              Effect.logWarning("Failed to detach SES identity from tenants", {
                cause,
                fqdn,
                region,
              }),
            ),
          );
          yield* ses
            .deleteEmailIdentity({ EmailIdentity: fqdn })
            .pipe(
              Effect.catchTags({ NotFoundException: () => Effect.void }),
              Effect.mapError(mapAwsError),
            );
        }),
      ensureInfrastructure: ({ deliveryWebhookUrl }) =>
        Effect.forEach(
          config.regions,
          (region) =>
            Effect.gen(function* () {
              const { mapAwsError, ses, sns } = yield* inRegion(region);
              yield* ensureSesInfrastructure({ deliveryWebhookUrl, mapAwsError, region, ses, sns });
            }),
          { discard: true },
        ),
      getIdentityStatus: ({ fqdn, region: recorded }) =>
        Effect.gen(function* () {
          const { mapAwsError, ses } = yield* inRegion(recorded);
          const identity = yield* ses
            .getEmailIdentity({ EmailIdentity: fqdn })
            .pipe(Effect.mapError(mapAwsError));
          return {
            dkimVerified: identity.DkimAttributes?.Status === "SUCCESS",
            verified: identity.VerifiedForSendingStatus === true,
          };
        }),
      send: ({ message, region: recorded }) =>
        Effect.gen(function* () {
          const { mapAwsError, region, ses } = yield* inRegion(recorded);
          return yield* Effect.gen(function* () {
            const attachments = yield* Effect.forEach(message.attachments ?? [], (attachment) =>
              Effect.try({
                catch: (cause) =>
                  new EmailBackendMessageError({
                    cause,
                    code: "invalid_attachment_encoding",
                    filename: attachment.filename,
                    region,
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
            const tenantName = yield* ensureTenantForSend(ses, {
              identityFqdn: message.sender.identityFqdn,
              region,
              tenantName: sesTenantNameFor(message.sender.projectId),
            });
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
                  // Paused for the Project's tenant only when SES says the tenant is
                  // disabled; otherwise the whole account is paused.
                  SendingPausedException: (error) =>
                    tenantName
                      ? isSesTenantPaused(ses, tenantName).pipe(
                          Effect.orElseSucceed(() => false),
                          Effect.flatMap((tenantPaused) =>
                            Effect.fail(
                              tenantPaused
                                ? new EmailBackendRejected({
                                    cause: error,
                                    reason: "project_sending_paused",
                                    region,
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
          }).pipe(Effect.mapError(mapAwsError));
        }),
    } satisfies EmailBackendService;
  });
