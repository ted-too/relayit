# Nitpicks

Living list of small code-style preferences that come up in review. Prefer these over inventing wrappers “for consistency.”

## Construct tagged errors at the call site

**Don't** add helper functions whose only job is to call `new SomeTaggedError({ ... })` with reordered/positional args.

```ts
// don't
export const emailDeliveryTerminal = (
  deliveryId: string,
  stage: string,
  message: string,
  cause?: unknown
) =>
  new MessageDeliveryTerminalError({
    cause,
    deliveryId,
    message,
    stage,
  });

return yield* emailDeliveryTerminal(id, "load", "not found");
```

**Do** construct the tagged error where it is raised (or mapped), with a named object payload.

```ts
// do
return yield* new MessageDeliveryTerminalError({
  deliveryId: id,
  message: "not found",
  stage: "load",
});
```

Why: the constructor *is* the API. A thin factory hides the fields, invites positional-arg mistakes, and duplicates every error shape.

This includes “local” helpers used only for `Effect.mapError` / `Effect.fail`:

```ts
// don't
const circuitError = (cause: unknown) =>
  new MessageDeliveryInfrastructureError({ cause, operation: "circuit" });
.pipe(Effect.mapError(circuitError));

const infrastructureError =
  (organizationId: string, operation: "sender") =>
  (cause: unknown) =>
    new EmailAcceptInfrastructureError({ cause, operation, organizationId });
```

```ts
// do
.pipe(
  Effect.mapError(
    (cause) =>
      new MessageDeliveryInfrastructureError({
        cause,
        operation: "circuit",
      })
  )
);
```

Inline `new` at the call site even when the same shape appears a few times. Do not extract a named factory for it.

## Classify tagged failures with `switch` on `_tag`

**Don't** export an `isXFailure` type-guard helper, and don't collapse classification to a single `instanceof` check.

```ts
// don't
export const isEmailDeliveryFailure = (error: unknown): error is EmailDeliveryFailure =>
  error instanceof ...;

Effect.mapError((error) =>
  isEmailDeliveryFailure(error)
    ? error
    : new MessageDeliveryRetryableError({ ... })
);

classifyFailure: (failure) =>
  failure instanceof MessageDeliveryTerminalError ? "terminal" : "retryable",
```

**Do** switch on `_tag` at the handler seam: `classifyFailure` lists which tags are retryable vs terminal, and any boundary `mapError` that normalizes foreign errors (SQL/Usage/etc.) uses the same tag switch — pass known delivery failures through, wrap the rest.

```ts
// do
classifyFailure: (failure: EmailDeliveryFailure) => {
  switch (failure._tag) {
    case "MessageDeliveryRetryableError":
    case "MessageDeliveryInfrastructureError":
    case "EmailDeliveryPersistenceError":
    case "EmailDeliveryProviderError":
      return "retryable";
    default:
      return "terminal";
  }
},
```

Why: the tagged union *is* the taxonomy. A shared type guard just re-lists the same tags in a less readable place. Prefer an explicit retryable allow-list (`default: "terminal"`) over “everything that isn’t terminal.”

## Use the shared DB aliases

**Don't** pick methods off `Effect.Success<typeof DB>` (or invent a structural `{ update: ... }` stub type) at call sites.

```ts
// don't
const updateDelivery = (
  db: {
    update: Effect.Success<typeof DB>["update"];
  },
  ...
)

const markSent = (db: Effect.Success<typeof DB>, ...) => ...
```

**Do** use the aliases from `@repo/persistence/db/effect`:

- `Database` — full client (has `transaction`, etc.)
- `DatabaseTransaction` — the `tx` passed into `transaction`
- `DatabaseExecutor` — `Database | DatabaseTransaction` for helpers that work with either

```ts
// do
import type {
  Database,
  DatabaseExecutor,
} from "@repo/persistence/db/effect";

const updateDelivery = (db: DatabaseExecutor, ...) => ...
const markSent = (db: Database, ...) => ...
```

Why: the aliases are the project’s DB surface. Structural picks drift, duplicate knowledge of the client shape, and fight transaction typing.

## Don’t wrap Context services in one-liner helpers

**Don't** add shallow Effect wrappers that only `yield*` a service and forward one method call.

```ts
// don't
export const confirmDeliveryUsage = (deliveryId: string) =>
  Effect.gen(function* () {
    const usage = yield* Usage;
    yield* usage.confirm({ deliveryId });
  });

yield* confirmDeliveryUsage(deliveryId);
```

**Do** take the service at the call site and call it.

```ts
// do
const usage = yield* Usage;
yield* usage.confirm({ deliveryId });
```

Why: the service *is* the API. A passthrough helper adds an import surface and another name to learn without hiding complexity or enabling reuse beyond a single call.

## Don’t re-export a function under a new name

**Don't** add a channel-specific alias that only calls a shared primitive and remaps its error.

```ts
// don't — email/accept/policy.ts
export const filterSuppressedRecipients = (db, input) =>
  filterSuppressedContacts(db, input).pipe(
    Effect.mapError(
      (error) =>
        new EmailAcceptInfrastructureError({
          cause: error.cause,
          operation: "suppressions",
          organizationId: input.organizationId,
        })
    )
  );
```

**Do** call the shared function at the real call site and map errors there.

```ts
// do — email/accept/accept.ts
yield* filterSuppressedContacts(db, input).pipe(
  Effect.mapError(
    (error) =>
      new EmailAcceptInfrastructureError({
        cause: error.cause,
        operation: "suppressions",
        organizationId: input.organizationId,
      })
  )
);
```

Why: two names for one behavior forces readers to chase an extra hop. Shared primitives (`messages/…`) are the API; channel orchestration maps errors where it uses them.

## Keep error `message` static; put identifiers in fields

**Don't** interpolate IDs, filenames, or other variables into `message` (or similar human-string fields). That breaks structured logging and forces log scrapers to parse prose.

```ts
// don't
new EmailAcceptRejected({
  code: "invalid_attachment",
  message: `Attachment "${filename}" exceeds the 10MB limit`,
});

new MessageDeliveryTerminalError({
  deliveryId,
  message: `Email Delivery ${deliveryId} not found`,
  stage: "load",
});
```

**Do** use a stable message and put the varying data on typed fields / `details`.

```ts
// do
new EmailAcceptRejected({
  code: "invalid_attachment",
  details: {
    filename,
    maxBytes: MAX_ATTACHMENT_BYTES,
    reason: "exceeds_size_limit",
  },
  message: "Attachment exceeds the size limit.",
});

new MessageDeliveryTerminalError({
  deliveryId,
  message: "Email Delivery not found",
  stage: "load",
});
```

Why: logs and metrics key off fields (`filename`, `deliveryId`, `reason`). `message` is for humans and clients; it should be stable copy, not a dump of context.

## Omit job `payload` when there is none

**Don't** declare an empty struct (or similar unit schema) just to satisfy `defineJob`, and don’t pass `{}` / `null` at enqueue/schedule/cancel call sites for those jobs.

```ts
// don't
export const emailVerifyPlatformSpfJob = defineJob({
  name: "email.verify-platform-spf",
  payload: Schema.Struct({}),
  recurrence: { identity: () => "platform" },
  retry: verifyRetry,
});

yield* jobs.schedule(emailVerifyPlatformSpfJob, {}, runAt);
yield* jobs.cancel(emailVerifyPlatformSpfJob, {});
```

**Do** omit `payload` on the contract. Producers use the no-payload overloads; wire encoding uses the shared unit schema (`jobPayloadNone`).

```ts
// do
export const emailVerifyPlatformSpfJob = defineJob({
  name: "email.verify-platform-spf",
  recurrence: { identity: () => "platform" },
  retry: verifyRetry,
});

yield* jobs.schedule(emailVerifyPlatformSpfJob, runAt);
yield* jobs.cancel(emailVerifyPlatformSpfJob);
```

Why: an empty payload is noise. The Jobs API already distinguishes unit jobs from payload-bearing ones; inventing `Struct({})` forces every call site to pass a dummy value.

## Don’t erase Effect Requirements at composition sites

**Don't** cast mixed job-handler lists (`as never`) or pin `runJobWorker` to `Effect<void, never, never>` to silence heterogeneous `Requirements`.

```ts
// don't — apps/api
runJobWorker(
  [registerJobHandler(email), registerJobHandler(webhook)] as never,
  options
) as Effect.Effect<void, never, never>;
```

**Do** keep the call site honest. If mixed handlers fail to type-check, fix the jobs package so registrations are covariant / tuple-inferred and `runJobWorker` returns the union of handler requirements.

```ts
// do
runJobWorker(
  [registerJobHandler(email), registerJobHandler(webhook)],
  options
);
```

Why: composition casts hide missing Layers. The worker runtime must actually provide every service the union requires.

