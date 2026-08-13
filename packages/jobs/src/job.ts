import type { Effect } from "effect";
import { Schema } from "effect";

/** Job payload schemas are self-contained Effect Schema codecs. */
export type JobSchema = Schema.Top;

/**
 * Wire schema for jobs that carry no payload. Prefer omitting `payload` on
 * `defineJob` rather than writing `Schema.Struct({})`.
 */
export const jobPayloadNone = Schema.Null;

export type JobPayloadNone = typeof jobPayloadNone;

export interface JobBackoffPolicy {
  readonly baseDelayMs: number;
  readonly maxDelayMs: number;
}

export interface JobRetryPolicy {
  readonly backoff: JobBackoffPolicy;
  readonly maxAttempts: number;
}

export type JobDispatch = "immediate" | "transactional";

export interface JobRecurrence<Payload> {
  readonly identity: (payload: Payload) => string;
}

interface JobDefinitionBase<Name extends string> {
  readonly name: Name;
  readonly retry: JobRetryPolicy;
}

interface JobDefinitionWithPayload<
  Name extends string,
  PayloadSchema extends JobSchema,
> extends JobDefinitionBase<Name> {
  readonly payload: PayloadSchema;
  readonly recurrence?: JobRecurrence<PayloadSchema["Type"]>;
}

interface JobDefinitionWithoutPayload<Name extends string>
  extends JobDefinitionBase<Name> {
  readonly payload?: undefined;
  readonly recurrence?: JobRecurrence<JobPayloadNone["Type"]>;
}

export interface Job<
  Name extends string,
  PayloadSchema extends JobSchema,
  Dispatch extends JobDispatch = JobDispatch,
> {
  readonly dispatch: Dispatch;
  readonly name: Name;
  readonly payload: PayloadSchema;
  readonly recurrence?: JobRecurrence<PayloadSchema["Type"]>;
  readonly retry: JobRetryPolicy;
}

export type RecurringJob<
  Name extends string,
  PayloadSchema extends JobSchema,
> = Job<Name, PayloadSchema, "immediate"> & {
  readonly recurrence: JobRecurrence<PayloadSchema["Type"]>;
};

export type JobPayload<Contract extends { readonly payload: JobSchema }> =
  Contract["payload"]["Type"];

/** True when the contract uses the unit (no-payload) schema. */
export const isJobPayloadNone = (contract: {
  readonly payload: JobSchema;
}): contract is { readonly payload: JobPayloadNone } =>
  contract.payload === jobPayloadNone;

export function defineJob<const Name extends string>(
  contract: JobDefinitionWithoutPayload<Name> & {
    readonly dispatch: "transactional";
    readonly recurrence?: never;
  }
): Job<Name, JobPayloadNone, "transactional">;
export function defineJob<
  const Name extends string,
  PayloadSchema extends JobSchema,
>(
  contract: JobDefinitionWithPayload<Name, PayloadSchema> & {
    readonly dispatch: "transactional";
    readonly recurrence?: never;
  }
): Job<Name, PayloadSchema, "transactional">;
export function defineJob<const Name extends string>(
  contract: JobDefinitionWithoutPayload<Name> & {
    readonly dispatch?: "immediate";
    readonly recurrence: JobRecurrence<JobPayloadNone["Type"]>;
  }
): RecurringJob<Name, JobPayloadNone>;
export function defineJob<
  const Name extends string,
  PayloadSchema extends JobSchema,
>(
  contract: JobDefinitionWithPayload<Name, PayloadSchema> & {
    readonly dispatch?: "immediate";
    readonly recurrence: JobRecurrence<PayloadSchema["Type"]>;
  }
): RecurringJob<Name, PayloadSchema>;
export function defineJob<const Name extends string>(
  contract: JobDefinitionWithoutPayload<Name> & {
    readonly dispatch?: "immediate";
    readonly recurrence?: undefined;
  }
): Job<Name, JobPayloadNone, "immediate">;
export function defineJob<
  const Name extends string,
  PayloadSchema extends JobSchema,
>(
  contract: JobDefinitionWithPayload<Name, PayloadSchema> & {
    readonly dispatch?: "immediate";
    readonly recurrence?: undefined;
  }
): Job<Name, PayloadSchema, "immediate">;
export function defineJob<
  const Name extends string,
  PayloadSchema extends JobSchema,
>(
  contract: (
    | JobDefinitionWithPayload<Name, PayloadSchema>
    | JobDefinitionWithoutPayload<Name>
  ) & {
    readonly dispatch?: JobDispatch;
  }
): Job<Name, PayloadSchema | JobPayloadNone, JobDispatch> {
  return {
    ...contract,
    dispatch: contract.dispatch ?? "immediate",
    payload: contract.payload ?? jobPayloadNone,
  } as Job<Name, PayloadSchema | JobPayloadNone, JobDispatch>;
}

export interface WorkExecution {
  readonly attempt: number;
  readonly enqueuedAt: number;
  readonly id: string;
}

interface JobContractShape {
  readonly dispatch: JobDispatch;
  readonly name: string;
  readonly payload: JobSchema;
  readonly recurrence?: {
    readonly identity: (payload: never) => string;
  };
  readonly retry: JobRetryPolicy;
}

export interface JobHandler<
  Contract extends JobContractShape,
  Failure,
  Requirements,
  DeadLetterFailure = never,
> {
  readonly classifyFailure: (failure: Failure) => "retryable" | "terminal";
  readonly contract: Contract;
  readonly handle: (
    payload: JobPayload<Contract>,
    execution: WorkExecution
  ) => Effect.Effect<unknown, Failure, Requirements>;
  readonly onDeadLetter?: (
    payload: JobPayload<Contract>,
    execution: WorkExecution,
    failure: Failure
  ) => Effect.Effect<unknown, DeadLetterFailure, Requirements>;
  readonly reconcile?: Effect.Effect<void, Failure, Requirements>;
}

/**
 * Infers `Failure` / requirements from `handle` so `classifyFailure` does not
 * need an explicit failure annotation.
 */
export const defineJobHandler = <
  Contract extends JobContractShape,
  A,
  E,
  R,
  DeadLetterFailure = never,
>(handler: {
  readonly contract: Contract;
  readonly handle: (
    payload: JobPayload<Contract>,
    execution: WorkExecution
  ) => Effect.Effect<A, E, R>;
  readonly classifyFailure: (failure: NoInfer<E>) => "retryable" | "terminal";
  readonly onDeadLetter?: (
    payload: JobPayload<Contract>,
    execution: WorkExecution,
    failure: NoInfer<E>
  ) => Effect.Effect<unknown, DeadLetterFailure, NoInfer<R>>;
  readonly reconcile?: Effect.Effect<void, NoInfer<E>, NoInfer<R>>;
}): JobHandler<Contract, E, R, DeadLetterFailure> => handler;
