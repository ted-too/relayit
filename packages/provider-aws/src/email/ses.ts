import { EventBridge } from "@effect-aws/client-eventbridge";
import { SESv2 } from "@effect-aws/client-sesv2";
import { SNS } from "@effect-aws/client-sns";
import {
  EmailBackendAuthenticationError,
  EmailBackendConfigurationError,
  EmailBackendMessageError,
  EmailBackendRejected,
  type EmailBackendService,
} from "@repo/channels/email/backend";
import { Effect, Layer } from "effect";
import { AwsUnexpectedResponseError, createAwsErrorMapper } from "../errors";
import type { EventsClient, SesClient, SnsClient } from "../operations";
import { deleteSesDomainIdentity, ensureSesDomainIdentity } from "./identity";
import { ensureSesInfrastructure, SES_CONFIGURATION_SET_NAME } from "./infrastructure";
import { ensureSesTenant, isSesTenantPaused, sesTenantSendingStatus } from "./tenant";
import { sesTenantNameFor } from "./tenant-name";

export interface SesConfig {
  readonly accessKeyId: string;
  /** `SES_REGIONS`, the first the default for new Domains. */
  readonly regions: readonly [string, ...string[]];
  readonly secretAccessKey: string;
}

/** Network failures before the request is written: resolving SES's host or connecting. */
const NOT_SENT_SYSCALLS = new Set(["connect", "getaddrinfo"]);

/**
 * TLS handshake and certificate-verification failures: the request is never written. Other
 * TLS errors can arrive mid-connection, after SES has the request, so they are not here.
 */
const NOT_SENT_TLS_CODES = new Set([
  "CERT_HAS_EXPIRED",
  "CERT_NOT_YET_VALID",
  "CERT_REVOKED",
  "CERT_SIGNATURE_FAILURE",
  "CERT_UNTRUSTED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "ERR_TLS_CERT_ALTNAME_INVALID",
  "ERR_TLS_HANDSHAKE_TIMEOUT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

/** The HTTP status SES answered with, which the SDK keeps on the error it reports. */
const httpStatusOf = (error: unknown) =>
  typeof error === "object" && error !== null && "$metadata" in error
    ? (error.$metadata as { readonly httpStatusCode?: number } | undefined)?.httpStatusCode
    : undefined;

/**
 * Whether a failed SendEmail proves SES never took the message: SES answered with a 4xx, or
 * the request never left (DNS or connect failed, by the failing syscall, or a listed TLS
 * handshake error). A network code on its own proves nothing: `EHOSTUNREACH` can come from a
 * read on a kept-alive connection after the request went out. Anything else, a reset or
 * timeout after the request was written, a 5xx or an unreadable answer, is unknown.
 */
export const provesNotSent = (error: unknown) => {
  const fields =
    typeof error === "object" && error !== null ? (error as Record<string, unknown>) : {};
  const status = httpStatusOf(error);
  if (status !== undefined) {
    return status >= 400 && status < 500;
  }
  return (
    (typeof fields.syscall === "string" && NOT_SENT_SYSCALLS.has(fields.syscall)) ||
    (typeof fields.code === "string" && NOT_SENT_TLS_CODES.has(fields.code))
  );
};

/** `${region}:${tenantName}:${fqdn}` already ensured by this process. */
const ensuredTenants = new Set<string>();

const clientsFor = (config: SesConfig, region: string) =>
  Effect.gen(function* () {
    // Typed as the operations the IAM policy grants: see `AWS_OPERATIONS`.
    const events: EventsClient = yield* EventBridge;
    // Only for SendEmail: a send the SDK retried after a reset or a 5xx could reach the
    // recipient twice. The delivery job decides what happens after an unanswered send.
    // Each send also opens its own connection. A kept-alive one that SES or the network
    // dropped while idle fails the write with the same reset a send SES took and never
    // answered does, and that outcome has to count as unknown; on a new connection a
    // send that cannot reach SES fails at connect, which proves nothing went out.
    const sendOnce: Pick<SesClient, "sendEmail"> = yield* Effect.gen(function* () {
      return yield* SESv2;
    }).pipe(
      // Fresh, or the client the layer below built (with the SDK's retries) is shared.
      Effect.provide(
        Layer.fresh(
          SESv2.layer({
            credentials: config,
            maxAttempts: 1,
            region,
            requestHandler: {
              httpAgent: { keepAlive: false },
              httpsAgent: { keepAlive: false },
            },
          }),
        ),
      ),
    );
    const ses: SesClient = yield* SESv2;
    const sns: SnsClient = yield* SNS;
    return {
      events,
      sendOnce,
      ses,
      sns,
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        EventBridge.layer({ credentials: config, region }),
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

    /** Regions already warned that the credentials may not read a tenant's status. */
    const tenantStatusDenied = new Set<string>();

    /**
     * Fail open: a tenant we could not ensure (e.g. IAM lacks ses:CreateTenant) sends
     * untenanted, as before tenants existed, and is retried on the next send.
     */
    const ensureTenantForSend = (
      ses: SesClient,
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
      deleteIdentity: ({ dkimSelector, fqdn, region: recorded }) =>
        Effect.gen(function* () {
          const { mapAwsError, region, ses } = yield* inRegion(recorded);
          return yield* deleteSesDomainIdentity(ses, { dkimSelector, fqdn, region }).pipe(
            Effect.mapError(mapAwsError),
          );
        }),
      ensureInfrastructure: ({ deliveryWebhookUrl }) =>
        Effect.forEach(
          config.regions,
          (region) =>
            Effect.gen(function* () {
              const { events, mapAwsError, ses, sns } = yield* inRegion(region);
              yield* ensureSesInfrastructure({
                deliveryWebhookUrl,
                events,
                mapAwsError,
                region,
                ses,
                sns,
              });
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
      getProjectSendingStatus: ({ projectId, region: recorded }) =>
        Effect.gen(function* () {
          const { mapAwsError, region, ses } = yield* inRegion(recorded);
          return yield* sesTenantSendingStatus(ses, sesTenantNameFor(projectId)).pipe(
            Effect.mapError((error) => {
              switch (error._tag) {
                // SES models no access-denied error, so the SDK reports credentials that may
                // not read the status (no `ses:GetTenant` or `ses:GetReputationEntity`, or a
                // key SES does not know) as an unmodelled 403. No retry gets past that, and
                // the recheck job has to tell it from SES being down.
                case "SdkError":
                  return httpStatusOf(error) === 403
                    ? new EmailBackendAuthenticationError({ cause: error, region })
                    : mapAwsError(error);
                default:
                  return mapAwsError(error);
              }
            }),
          );
        }),
      send: ({ message, region: recorded }) =>
        Effect.gen(function* () {
          const { mapAwsError, region, sendOnce, ses } = yield* inRegion(recorded);
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
            const result = yield* sendOnce
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
                          // Unread, the pause is reported as SES gave it, for no one in
                          // particular: pausing the Project's Domains on a guess would
                          // leave them paused after an account's pause ended.
                          Effect.catch((cause) => {
                            if (httpStatusOf(cause) !== 403) {
                              return Effect.logWarning(
                                "SES paused sending and the Project's tenant status could not be read; treating the pause as the account's",
                                { cause, region, tenantName },
                              ).pipe(Effect.as(false));
                            }
                            // SES models no access-denied error: a 403 is the credentials.
                            // Once per region, or every send of a paused Project says it.
                            if (tenantStatusDenied.has(region)) {
                              return Effect.succeed(false);
                            }
                            tenantStatusDenied.add(region);
                            return Effect.logWarning(
                              'SES paused sending and refused to say whether for this Project or the whole account: the SES IAM policy needs ses:GetTenant (docs/aws-ses-iam-policy.json). Until it is granted a Project Sending Pause pauses no Domain; its sends are accepted, retried and fail as "SES paused sending"',
                              { cause, region, tenantName },
                            ).pipe(Effect.as(false));
                          }),
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
          }).pipe(
            Effect.mapError((error) => {
              const mapped = mapAwsError(error);
              // The shared mapper calls anything it does not model unavailable. For a send that
              // means "SES may have it", unless the error proves SES never took it.
              return mapped._tag === "EmailBackendUnavailable" && provesNotSent(error)
                ? new EmailBackendRejected({ cause: error, reason: "not_sent", region })
                : mapped;
            }),
          );
        }),
    } satisfies EmailBackendService;
  });
