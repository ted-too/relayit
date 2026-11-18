import type { SESv2 } from "@effect-aws/client-sesv2";
import { EmailBackendIdentityConflict, type IdentityResult } from "@repo/channels/email/backend";
import { Effect } from "effect";
import { detachSesIdentityFromTenants, type SesTenantClient } from "./tenant";

export type SesIdentityClient = Pick<
  SESv2.Type,
  "createEmailIdentity" | "getEmailIdentity" | "putEmailIdentityMailFromAttributes"
>;

/**
 * Whether an SES identity is the one Relayit made for the Domain holding `dkimSelector`.
 *
 * This is how an identity is known to be Relayit's. Every identity Relayit makes is BYODKIM
 * with a selector generated for one Domain and kept on its row, and SES reports a BYODKIM
 * identity's selector as its only DKIM token. So the selector answers for identities made
 * before anything checked it too, with no tag to add to them and no action beyond
 * `ses:GetEmailIdentity`. An identity made by hand or by another system, Easy DKIM or
 * BYODKIM, does not carry a selector Relayit generated at random for this Domain.
 */
const isIdentityOfSelector = (
  identity: {
    readonly DkimAttributes?: {
      readonly SigningAttributesOrigin?: string;
      readonly Tokens?: readonly string[];
    };
  },
  dkimSelector: string,
) =>
  identity.DkimAttributes?.SigningAttributesOrigin === "EXTERNAL" &&
  identity.DkimAttributes.Tokens?.length === 1 &&
  identity.DkimAttributes.Tokens[0] === dkimSelector;

/**
 * Creates the Domain's SES identity as BYODKIM, then sets MAIL FROM.
 *
 * An identity that already exists is the Domain's only if an earlier attempt at this
 * registration made it (`isIdentityOfSelector`); it already signs with the Domain's key, so
 * there is nothing to apply. Any other is refused untouched: its DKIM is not rewritten, it
 * is not deleted and its MAIL FROM is not set.
 */
export const ensureSesDomainIdentity = (
  ses: SesIdentityClient,
  input: {
    readonly dkimPrivateKey: string;
    readonly dkimSelector: string;
    readonly fqdn: string;
    readonly region: string;
  },
) =>
  Effect.gen(function* () {
    // Created first and looked at only when SES says it exists, so that nothing can make
    // an identity between a look and the create.
    yield* ses
      .createEmailIdentity({
        DkimSigningAttributes: {
          DomainSigningPrivateKey: input.dkimPrivateKey,
          DomainSigningSelector: input.dkimSelector,
        },
        EmailIdentity: input.fqdn,
      })
      .pipe(
        Effect.catchTags({
          AlreadyExistsException: () =>
            ses.getEmailIdentity({ EmailIdentity: input.fqdn }).pipe(
              Effect.flatMap((existing) =>
                isIdentityOfSelector(existing, input.dkimSelector)
                  ? Effect.void
                  : Effect.fail(
                      new EmailBackendIdentityConflict({
                        fqdn: input.fqdn,
                        region: input.region,
                      }),
                    ),
              ),
            ),
        }),
      );

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
    } satisfies IdentityResult;
  });

/**
 * Deletes the SES identity of a removed Domain: the one signing with its selector. One of
 * that name signing with anything else is left as it is. It is an identity Relayit did not
 * make, which a Domain refused for it must not delete on its way out, or the identity of a
 * Domain added since.
 */
export const deleteSesDomainIdentity = (
  ses: Pick<SESv2.Type, "deleteEmailIdentity" | "getEmailIdentity"> & SesTenantClient,
  input: { readonly dkimSelector: string; readonly fqdn: string; readonly region: string },
) =>
  Effect.gen(function* () {
    const existing = yield* ses
      .getEmailIdentity({ EmailIdentity: input.fqdn })
      .pipe(Effect.catchTags({ NotFoundException: () => Effect.succeed(null) }));
    if (!existing) {
      return;
    }
    if (!isIdentityOfSelector(existing, input.dkimSelector)) {
      yield* Effect.logWarning("Left an SES identity that was not made for the removed Domain", {
        fqdn: input.fqdn,
        region: input.region,
      });
      return;
    }
    // Best effort: if this fails, deleteEmailIdentity below surfaces the real error while
    // associations remain.
    yield* detachSesIdentityFromTenants(ses, input).pipe(
      Effect.catch((cause) =>
        Effect.logWarning("Failed to detach SES identity from tenants", {
          cause,
          fqdn: input.fqdn,
          region: input.region,
        }),
      ),
    );
    yield* ses
      .deleteEmailIdentity({ EmailIdentity: input.fqdn })
      .pipe(Effect.catchTags({ NotFoundException: () => Effect.void }));
  });
