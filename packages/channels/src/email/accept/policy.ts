import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import {
  customDomain,
  emailDomainProviderIdentity,
  member,
  organization,
  organizationDomain,
  type ProviderKind,
  provider,
  sandboxDomain,
  user,
} from "@repo/persistence/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";
import {
  type MessageContactInput,
  normalizeContactEmail,
} from "../../messages/accept/contacts";
import { type ResolvedEmailSender, SANDBOX_FROM_LOCAL_PART } from "../sender";
import { EmailAcceptInfrastructureError, EmailAcceptRejected } from "./errors";

export const resolveEmailSender = (
  db: DatabaseExecutor,
  input: {
    readonly fromAddress: string;
    readonly organizationId: string;
  }
) =>
  Effect.gen(function* () {
    const normalizedFrom = normalizeContactEmail(input.fromAddress);
    const fromDomain = normalizedFrom.split("@")[1];
    if (!fromDomain) {
      return yield* new EmailAcceptRejected({
        code: "invalid_from_address",
        message:
          "The 'from' address is not a verified sending domain for this Project.",
      });
    }

    const [sandbox] = yield* db
      .select({
        id: sandboxDomain.id,
        isActive: sandboxDomain.isActive,
        isPaused: sandboxDomain.isPaused,
        rootDomain: sandboxDomain.rootDomain,
        verificationStatus: sandboxDomain.verificationStatus,
      })
      .from(organization)
      .leftJoin(
        sandboxDomain,
        eq(organization.sandboxDomainId, sandboxDomain.id)
      )
      .where(eq(organization.id, input.organizationId))
      .limit(1)
      .pipe(
        Effect.mapError(
          (cause) =>
            new EmailAcceptInfrastructureError({
              cause,
              operation: "sender",
              organizationId: input.organizationId,
            })
        )
      );

    if (
      sandbox?.id &&
      normalizedFrom ===
        normalizeContactEmail(
          `${SANDBOX_FROM_LOCAL_PART}@${sandbox.rootDomain}`
        ) &&
      sandbox.isActive &&
      !sandbox.isPaused &&
      sandbox.verificationStatus === "verified"
    ) {
      return {
        kind: "sandbox",
        sandboxDomainId: sandbox.id,
      } satisfies ResolvedEmailSender;
    }

    const [custom] = yield* db
      .select({ customDomainId: customDomain.id })
      .from(organizationDomain)
      .innerJoin(
        customDomain,
        eq(organizationDomain.customDomainId, customDomain.id)
      )
      .where(
        and(
          eq(organizationDomain.organizationId, input.organizationId),
          eq(sql`lower(${customDomain.fqdn})`, fromDomain),
          eq(customDomain.verificationStatus, "verified"),
          eq(customDomain.isPaused, false)
        )
      )
      .limit(1)
      .pipe(
        Effect.mapError(
          (cause) =>
            new EmailAcceptInfrastructureError({
              cause,
              operation: "sender",
              organizationId: input.organizationId,
            })
        )
      );

    if (custom) {
      return {
        customDomainId: custom.customDomainId,
        kind: "custom",
      } satisfies ResolvedEmailSender;
    }

    return yield* new EmailAcceptRejected({
      code: "invalid_from_address",
      message:
        "The 'from' address is not a verified sending domain for this Project.",
    });
  });

export const resolveEmailProviderKind = (
  db: DatabaseExecutor,
  organizationId: string,
  sender: ResolvedEmailSender
): Effect.Effect<ProviderKind, EmailAcceptInfrastructureError> => {
  if (sender.kind === "sandbox") {
    return Effect.succeed("managed");
  }

  return db
    .select({ scope: provider.scope })
    .from(emailDomainProviderIdentity)
    .innerJoin(
      provider,
      eq(emailDomainProviderIdentity.providerId, provider.id)
    )
    .where(
      and(
        eq(emailDomainProviderIdentity.customDomainId, sender.customDomainId),
        eq(emailDomainProviderIdentity.isActive, true),
        eq(emailDomainProviderIdentity.verificationStatus, "verified")
      )
    )
    .limit(1)
    .pipe(
      Effect.map(([identity]) =>
        identity?.scope === "platform" ? "managed" : "byo"
      ),
      Effect.mapError(
        (cause) =>
          new EmailAcceptInfrastructureError({
            cause,
            operation: "sender",
            organizationId,
          })
      )
    );
};

export const assertSandboxRecipientsAreMembers = (
  db: DatabaseExecutor,
  input: {
    readonly organizationId: string;
    readonly recipients: readonly MessageContactInput[];
  }
) =>
  db
    .select({ email: user.email })
    .from(member)
    .innerJoin(user, eq(member.userId, user.id))
    .where(eq(member.organizationId, input.organizationId))
    .pipe(
      Effect.mapError(
        (cause) =>
          new EmailAcceptInfrastructureError({
            cause,
            operation: "sender",
            organizationId: input.organizationId,
          })
      ),
      Effect.flatMap((rows) => {
        const memberEmails = new Set(
          rows.map((row) => normalizeContactEmail(row.email))
        );
        const hasNonMember = input.recipients.some(
          (recipient) =>
            !memberEmails.has(normalizeContactEmail(recipient.email))
        );
        return hasNonMember
          ? Effect.fail(
              new EmailAcceptRejected({
                code: "sandbox_recipient_not_member",
                message:
                  "Sandbox Domain sends may only target Project member email addresses.",
              })
            )
          : Effect.void;
      })
    );
