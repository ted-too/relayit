import type { DatabaseTransaction } from "@repo/persistence/db/effect";
import { member, organization, organizationDomain, userChannel } from "@repo/persistence/db/schema";
import { and, countDistinct, eq, exists, isNull, ne, or } from "drizzle-orm";
import { Data, Effect, Schema } from "effect";

/** The Billing User's Plan allows no further Domain. */
export class DomainLimitReached extends Data.TaggedError("DomainLimitReached")<{
  readonly billingUserId: string;
  readonly held: number;
  readonly limit: number;
  readonly message: string;
  readonly organizationId: string;
}> {}

/**
 * The Plan's Domain limit could not be read, so the add is refused: read loosely, a missing
 * limit is no limit.
 */
export class DomainLimitUnreadable extends Data.TaggedError("DomainLimitUnreadable")<{
  readonly cause?: unknown;
  readonly code: "billing_user_not_found" | "channel_limits_invalid" | "channel_limits_not_found";
  readonly message: string;
  readonly organizationId: string;
}> {}

// Required, and null or a count: a row without it, or in any other shape, refuses the add.
const decodeDomainLimit = Schema.decodeUnknownEffect(
  Schema.Struct({
    customDomains: Schema.NullOr(
      Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
    ),
  }),
);

/**
 * Refuses a new link between a Project and a Domain once the Project's Billing User holds as
 * many Domains as their Plan's `customDomains` allows; null allows any number, which is what
 * every row holds on a deployment without Stripe. Call it in the transaction that writes the
 * link, before the write.
 *
 * A Domain counts from the moment a Project is linked to it, a claim not yet proven
 * included: counted only once proven, claims could be made without limit and proven later.
 * Domains are counted across every Project the Billing User is Billing User for, each once
 * however many of those Projects are linked to it, so `customDomainId`, the Domain about to
 * be claimed, costs nothing when another of their Projects is already linked to it. The
 * Sandbox Domain is not an `organization_domain` link and never counts.
 *
 * Only a new link is checked. A Billing User already over the limit keeps every Domain and
 * goes on sending, and a claim made within the limit is still proven after a downgrade.
 *
 * The Billing User's `user_channel` row is locked to the end of the transaction, so of two
 * adds racing at the limit, in one Project or two, the second counts the first's link.
 */
export const requireDomainAllowance = (
  tx: DatabaseTransaction,
  input: { readonly customDomainId?: string; readonly organizationId: string },
) =>
  Effect.gen(function* () {
    // The Billing User as the Usage policy resolves it: the Project's, else its owner.
    const [project] = yield* tx
      .select({ billingUserId: organization.billingUserId })
      .from(organization)
      .where(eq(organization.id, input.organizationId));
    const billingUserId =
      project?.billingUserId ??
      (yield* tx
        .select({ userId: member.userId })
        .from(member)
        .where(and(eq(member.organizationId, input.organizationId), eq(member.role, "owner")))
        .limit(1))[0]?.userId;
    if (!billingUserId) {
      return yield* new DomainLimitUnreadable({
        code: "billing_user_not_found",
        message: "The Project has no Billing User to read a Domain limit from.",
        organizationId: input.organizationId,
      });
    }

    const [channel] = yield* tx
      .select({ limits: userChannel.limits })
      .from(userChannel)
      .where(and(eq(userChannel.userId, billingUserId), eq(userChannel.channelType, "email")))
      .for("update");
    if (!channel) {
      return yield* new DomainLimitUnreadable({
        code: "channel_limits_not_found",
        message: "The Billing User has no email limits to read a Domain limit from.",
        organizationId: input.organizationId,
      });
    }
    const { customDomains: limit } = yield* decodeDomainLimit(channel.limits).pipe(
      Effect.mapError(
        (cause) =>
          new DomainLimitUnreadable({
            cause,
            code: "channel_limits_invalid",
            message: "The Billing User's email limits hold no readable Domain limit.",
            organizationId: input.organizationId,
          }),
      ),
    );
    if (limit === null) {
      return;
    }

    const [counted] = yield* tx
      .select({ held: countDistinct(organizationDomain.customDomainId) })
      .from(organizationDomain)
      .innerJoin(organization, eq(organization.id, organizationDomain.organizationId))
      .where(
        and(
          or(
            eq(organization.billingUserId, billingUserId),
            and(
              isNull(organization.billingUserId),
              exists(
                tx
                  .select({ id: member.id })
                  .from(member)
                  .where(
                    and(
                      eq(member.organizationId, organization.id),
                      eq(member.role, "owner"),
                      eq(member.userId, billingUserId),
                    ),
                  ),
              ),
            ),
          ),
          input.customDomainId
            ? ne(organizationDomain.customDomainId, input.customDomainId)
            : undefined,
        ),
      );
    const held = counted?.held ?? 0;
    if (held >= limit) {
      return yield* new DomainLimitReached({
        billingUserId,
        held,
        limit,
        message:
          "The Project's Plan doesn't allow another Domain. Remove a Domain or a pending claim, or upgrade the Billing User's Plan.",
        organizationId: input.organizationId,
      });
    }
  });
