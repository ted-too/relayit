import type { ChannelType, MessagePurpose } from "@repo/persistence/db/schema";
import { Redis } from "@repo/redis";
import { Context, Data, Effect, Layer } from "effect";
import { makeUsageLedger } from "./usage-ledger";
import { UsagePolicy, type UsagePolicyError, type UsagePolicyResult } from "./usage-policy";

export {
  UsagePolicy,
  UsagePolicyLive,
  type UsagePolicyResult,
  type UsagePolicyService,
} from "./usage-policy";

export interface UsageReservationInput {
  readonly channel: ChannelType;
  readonly deliveryId: string;
  readonly organizationId: string;
  readonly purpose: MessagePurpose;
  readonly reservedAt: string;
}

export interface UsageReservationRef {
  readonly deliveryId: string;
}

export class UsageLimitExceeded extends Data.TaggedError("UsageLimitExceeded")<{
  readonly deliveryId: string;
  readonly retryAt: Date;
  readonly window: "daily" | "monthly";
}> {}

export class UsageReservationConflict extends Data.TaggedError("UsageReservationConflict")<{
  readonly deliveryId: string;
  readonly message: string;
}> {}

export class UsageReservationNotFound extends Data.TaggedError("UsageReservationNotFound")<{
  readonly deliveryId: string;
}> {}

export class UsageInfrastructureError extends Data.TaggedError("UsageInfrastructureError")<{
  readonly cause: unknown;
  readonly operation: "confirm" | "release" | "reserve";
}> {}

export type UsageError =
  | UsageInfrastructureError
  | UsageLimitExceeded
  | UsagePolicyError
  | UsageReservationConflict
  | UsageReservationNotFound;

export interface UsageService {
  readonly confirm: (input: UsageReservationRef) => Effect.Effect<void, UsageError>;
  readonly release: (input: UsageReservationRef) => Effect.Effect<void, UsageError>;
  readonly reserve: (input: UsageReservationInput) => Effect.Effect<UsagePolicyResult, UsageError>;
}

export class Usage extends Context.Service<Usage, UsageService>()("Channels/Usage") {}

const reservationResult = (
  code: number,
  input: {
    readonly deliveryId: string;
    readonly policy: UsagePolicyResult;
    readonly reservedAt: string;
  },
): Effect.Effect<UsagePolicyResult, UsageError> => {
  switch (code) {
    case 0:
      return Effect.succeed(input.policy);
    case 1: {
      const reservedAt = new Date(input.reservedAt);
      return Effect.fail(
        new UsageLimitExceeded({
          deliveryId: input.deliveryId,
          retryAt: new Date(
            Date.UTC(
              reservedAt.getUTCFullYear(),
              reservedAt.getUTCMonth(),
              reservedAt.getUTCDate() + 1,
            ),
          ),
          window: "daily",
        }),
      );
    }
    case 2:
      return Effect.fail(
        new UsageLimitExceeded({
          deliveryId: input.deliveryId,
          retryAt: input.policy.periodEnd,
          window: "monthly",
        }),
      );
    case 3:
      return Effect.fail(
        new UsageReservationConflict({
          deliveryId: input.deliveryId,
          message: "Delivery Usage was reserved with different dimensions",
        }),
      );
    case 4:
      return Effect.fail(new UsageReservationNotFound({ deliveryId: input.deliveryId }));
    default:
      return Effect.fail(
        new UsageReservationConflict({
          deliveryId: input.deliveryId,
          message: "Delivery Usage is already finalized",
        }),
      );
  }
};

const finalizeResult = (
  code: number,
  deliveryId: string,
  operation: "confirm" | "release",
): Effect.Effect<void, UsageReservationConflict | UsageReservationNotFound> => {
  if (code === 0) {
    return Effect.void;
  }
  if (code === 4) {
    return Effect.fail(new UsageReservationNotFound({ deliveryId }));
  }
  return Effect.fail(
    new UsageReservationConflict({
      deliveryId,
      message:
        operation === "confirm"
          ? "Released Usage cannot be confirmed"
          : "Usage could not be released",
    }),
  );
};

export const UsageLive = Layer.effect(
  Usage,
  Effect.gen(function* () {
    const ledger = makeUsageLedger(yield* Redis);
    const policies = yield* UsagePolicy;

    const reserve = (input: UsageReservationInput) =>
      Effect.gen(function* () {
        const policy = yield* policies.resolve(input);
        const code = yield* ledger
          .reserve(input.deliveryId, input, policy)
          .pipe(
            Effect.mapError(
              (cause) => new UsageInfrastructureError({ cause, operation: "reserve" }),
            ),
          );
        return yield* reservationResult(code, {
          deliveryId: input.deliveryId,
          policy,
          reservedAt: input.reservedAt,
        });
      });

    const finalize =
      (operation: "confirm" | "release") =>
      ({ deliveryId }: UsageReservationRef): Effect.Effect<void, UsageError> =>
        ledger[operation](deliveryId).pipe(
          Effect.mapError((cause) => new UsageInfrastructureError({ cause, operation })),
          Effect.flatMap((code) => finalizeResult(code, deliveryId, operation)),
        );

    return {
      confirm: finalize("confirm"),
      release: finalize("release"),
      reserve,
    } satisfies UsageService;
  }),
);
