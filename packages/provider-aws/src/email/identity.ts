import type { SESv2 } from "@effect-aws/client-sesv2";
import type { IdentityResult } from "@repo/channels/email/provider-adapter";
import { Effect } from "effect";

export type SesIdentityClient = Pick<
  SESv2.Type,
  | "createEmailIdentity"
  | "deleteEmailIdentity"
  | "getEmailIdentity"
  | "putEmailIdentityDkimSigningAttributes"
  | "putEmailIdentityMailFromAttributes"
>;

const isByodkimConversionFailure = (error: {
  readonly _tag: string;
}): boolean => {
  switch (error._tag) {
    case "BadRequestException":
    case "ConflictException":
    case "SdkError":
      return true;
    default:
      return false;
  }
};

/**
 * Create or adopt an SES domain identity as BYODKIM, then set MAIL FROM.
 *
 * Pre-existing Easy DKIM identities (console default) are rewritten to
 * EXTERNAL. If SES rejects that conversion, the identity is deleted and
 * recreated with BYODKIM.
 */
export const ensureSesDomainIdentity = (
  ses: SesIdentityClient,
  input: {
    readonly dkimPrivateKey: string;
    readonly dkimSelector: string;
    readonly fqdn: string;
    readonly region: string;
  }
) => {
  const createByodkim = () =>
    ses.createEmailIdentity({
      DkimSigningAttributes: {
        DomainSigningPrivateKey: input.dkimPrivateKey,
        DomainSigningSelector: input.dkimSelector,
      },
      EmailIdentity: input.fqdn,
    });

  const applyByodkim = () =>
    ses.putEmailIdentityDkimSigningAttributes({
      EmailIdentity: input.fqdn,
      SigningAttributes: {
        DomainSigningPrivateKey: input.dkimPrivateKey,
        DomainSigningSelector: input.dkimSelector,
      },
      SigningAttributesOrigin: "EXTERNAL",
    });

  const replaceWithByodkim = () =>
    ses.deleteEmailIdentity({ EmailIdentity: input.fqdn }).pipe(
      Effect.catchTag("NotFoundException", () => Effect.void),
      Effect.andThen(createByodkim)
    );

  const adoptExisting = (origin: string | undefined) =>
    origin === "EXTERNAL"
      ? applyByodkim()
      : applyByodkim().pipe(
          Effect.catchIf(isByodkimConversionFailure, replaceWithByodkim)
        );

  return Effect.gen(function* () {
    const existing = yield* ses
      .getEmailIdentity({ EmailIdentity: input.fqdn })
      .pipe(Effect.catchTag("NotFoundException", () => Effect.succeed(null)));

    if (existing) {
      yield* adoptExisting(existing.DkimAttributes?.SigningAttributesOrigin);
    } else {
      yield* createByodkim().pipe(
        Effect.catchTag("AlreadyExistsException", () =>
          applyByodkim().pipe(
            Effect.catchIf(isByodkimConversionFailure, replaceWithByodkim)
          )
        )
      );
    }

    const mailFromDomain = `send.${input.fqdn}`;
    yield* ses.putEmailIdentityMailFromAttributes({
      BehaviorOnMxFailure: "USE_DEFAULT_VALUE",
      EmailIdentity: input.fqdn,
      MailFromDomain: mailFromDomain,
    });

    return {
      mailFrom: {
        domain: mailFromDomain,
        records: [
          {
            name: mailFromDomain,
            priority: 10,
            purpose: "mail_from_mx",
            recordType: "MX",
            value: `feedback-smtp.${input.region}.amazonses.com`,
          },
          {
            name: mailFromDomain,
            priority: null,
            purpose: "mail_from_spf",
            recordType: "TXT",
            value: '"v=spf1 include:amazonses.com ~all"',
          },
        ],
      },
      providerData: { dkimSelector: input.dkimSelector },
    } satisfies IdentityResult;
  });
};
