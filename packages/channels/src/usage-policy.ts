import { DB } from "@repo/persistence/db/effect";
import type {
  ChannelType,
  EmailLimits,
  MessagePurpose,
  ProviderKind,
} from "@repo/persistence/db/schema";
import { Context, Data, Effect, Layer } from "effect";

export interface UsagePolicyInput {
  readonly billingUserId?: string;
  readonly channel: ChannelType;
  readonly organizationId: string;
  readonly providerKind: ProviderKind;
  readonly purpose: MessagePurpose;
  readonly reservedAt: string;
}

export interface UsagePolicyResult {
  readonly billingUserId: string;
  readonly dailyLimit: number | null;
  readonly monthlyLimit: number | null;
  readonly periodEnd: Date;
  readonly periodStart: Date;
}

export class UsagePolicyError extends Data.TaggedError("UsagePolicyError")<{
  readonly cause?: unknown;
  readonly code:
    | "billing_user_not_found"
    | "channel_limits_not_found"
    | "user_not_found";
  readonly organizationId: string;
}> {}

export interface UsagePolicyService {
  readonly resolve: (
    input: UsagePolicyInput
  ) => Effect.Effect<UsagePolicyResult, UsagePolicyError>;
}

export class UsagePolicy extends Context.Service<
  UsagePolicy,
  UsagePolicyService
>()("Channels/UsagePolicy") {}

const asDate = (value: Date | string) =>
  value instanceof Date ? value : new Date(value);

const anniversaryDate = (year: number, month: number, anchor: Date) =>
  new Date(
    Date.UTC(
      year,
      month,
      Math.min(
        anchor.getUTCDate(),
        new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
      ),
      anchor.getUTCHours(),
      anchor.getUTCMinutes(),
      anchor.getUTCSeconds(),
      anchor.getUTCMilliseconds()
    )
  );

const anniversaryPeriod = (anchor: Date, at: Date) => {
  let start = anniversaryDate(at.getUTCFullYear(), at.getUTCMonth(), anchor);
  if (at < start) {
    const month = at.getUTCMonth() === 0 ? 11 : at.getUTCMonth() - 1;
    const year =
      at.getUTCMonth() === 0 ? at.getUTCFullYear() - 1 : at.getUTCFullYear();
    start = anniversaryDate(year, month, anchor);
  }
  const month = start.getUTCMonth() === 11 ? 0 : start.getUTCMonth() + 1;
  const year =
    start.getUTCMonth() === 11
      ? start.getUTCFullYear() + 1
      : start.getUTCFullYear();
  return { end: anniversaryDate(year, month, anchor), start };
};

export const UsagePolicyLive = Layer.effect(
  UsagePolicy,
  Effect.gen(function* () {
    const db = yield* DB;

    return {
      resolve: (input) =>
        Effect.gen(function* () {
          const organization = input.billingUserId
            ? undefined
            : yield* db.query.organization
                .findFirst({
                  columns: { billingUserId: true },
                  where: { id: input.organizationId },
                })
                .pipe(
                  Effect.mapError(
                    (cause) =>
                      new UsagePolicyError({
                        cause,
                        code: "billing_user_not_found",
                        organizationId: input.organizationId,
                      })
                  )
                );

          const billingUserId =
            input.billingUserId ??
            organization?.billingUserId ??
            (yield* db.query.member
              .findFirst({
                columns: { userId: true },
                where: {
                  organizationId: input.organizationId,
                  role: "owner",
                },
              })
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new UsagePolicyError({
                      cause,
                      code: "billing_user_not_found",
                      organizationId: input.organizationId,
                    })
                )
              ))?.userId;

          if (!billingUserId) {
            return yield* new UsagePolicyError({
              code: "billing_user_not_found",
              organizationId: input.organizationId,
            });
          }

          const resolved = yield* Effect.all({
            channel: db.query.userChannel.findFirst({
              where: { channelType: input.channel, userId: billingUserId },
            }),
            subscriptions: db.query.subscription.findMany({
              where: { referenceId: billingUserId },
            }),
            user: db.query.user.findFirst({
              columns: { createdAt: true },
              where: { id: billingUserId },
            }),
          }).pipe(
            Effect.mapError(
              (cause) =>
                new UsagePolicyError({
                  cause,
                  code: "channel_limits_not_found",
                  organizationId: input.organizationId,
                })
            )
          );
          const { channel, subscriptions, user } = resolved;

          if (!channel) {
            return yield* new UsagePolicyError({
              code: "channel_limits_not_found",
              organizationId: input.organizationId,
            });
          }
          if (!user) {
            return yield* new UsagePolicyError({
              code: "user_not_found",
              organizationId: input.organizationId,
            });
          }

          const reservedAt = new Date(input.reservedAt);
          const subscription = subscriptions.find((candidate) => {
            if (
              (candidate.status !== "active" &&
                candidate.status !== "trialing") ||
              !candidate.periodStart ||
              !candidate.periodEnd
            ) {
              return false;
            }
            return (
              asDate(candidate.periodStart) <= reservedAt &&
              asDate(candidate.periodEnd) > reservedAt
            );
          });
          const period =
            subscription?.periodStart && subscription.periodEnd
              ? {
                  end: asDate(subscription.periodEnd),
                  start: asDate(subscription.periodStart),
                }
              : anniversaryPeriod(asDate(user.createdAt), reservedAt);
          const limits = channel.limits as EmailLimits;
          const bucket = limits[input.purpose][input.providerKind];

          return {
            billingUserId,
            dailyLimit: bucket.dailySends,
            monthlyLimit: bucket.monthlySends,
            periodEnd: period.end,
            periodStart: period.start,
          } satisfies UsagePolicyResult;
        }),
    } satisfies UsagePolicyService;
  })
);
