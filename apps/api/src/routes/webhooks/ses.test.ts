import { describe, expect, test } from "bun:test";
import { Jobs, type JobsService } from "@repo/jobs";
import type { Database } from "@repo/persistence/db/effect";
import { DB } from "@repo/persistence/db/effect";
import { AwsSnsValidationError } from "@repo/provider-aws/errors";
import type { handleSesNotification } from "@repo/provider-aws/email/webhooks";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Elysia } from "elysia";
import type { RunApiEffect } from "../../lib/effect";
import { createSesNotificationRoutes } from "./ses";

const makeApp = (handle: typeof handleSesNotification, db: Partial<Database> = {}) => {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(Layer.succeed(DB, db as Database), Layer.succeed(Jobs, {} as JobsService)),
  );
  const runEffect = runtime.runPromise as RunApiEffect;
  const app = new Elysia().use(createSesNotificationRoutes(runEffect, handle));
  return { app, runtime };
};

// Production's SNS subscriptions point at this URL; it must not move.
const post = (app: { handle: (request: Request) => Response | Promise<Response> }, body: string) =>
  Promise.resolve(
    app.handle(
      new Request("http://localhost/webhooks/providers/aws/ses", {
        body,
        headers: { "content-type": "text/plain" },
        method: "POST",
      }),
    ),
  );

describe("POST /webhooks/providers/aws/ses", () => {
  test("accepts a notification with nothing to record", () => {
    let received: string | undefined;
    const { app, runtime } = makeApp((rawBody) => {
      received = rawBody;
      return Effect.succeed({ type: "noop" } as const);
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => post(app, '{"Type":"Notification"}'));

        expect(response.status).toBe(200);
        expect(yield* Effect.promise(() => response.json())).toEqual({ ok: true });
        expect(received).toBe('{"Type":"Notification"}');
      }).pipe(Effect.ensuring(runtime.disposeEffect)),
    );
  });

  test("refuses a message that fails SNS's checks, which SNS does not retry", () => {
    const { app, runtime } = makeApp(() => Effect.fail(new AwsSnsValidationError({})));

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => post(app, "not-json"));

        expect(response.status).toBe(400);
        expect(yield* Effect.promise(() => response.json())).toEqual({
          code: "bad_request",
          message: "SES notification handling failed",
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect)),
    );
  });

  test("answers 500 when an outcome cannot be recorded, so SNS retries it", () => {
    const { app, runtime } = makeApp(
      () =>
        Effect.succeed({
          events: [
            {
              kind: "bounced",
              providerMessageId: "ses-1",
              raw: {},
              recipients: ["a@example.com"],
              suppress: true,
            },
          ],
          type: "events",
        } as const),
      {
        query: {
          emailDelivery: { findFirst: () => Effect.die("database down") },
        } as never,
      },
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() => post(app, "{}"));

        expect(response.status).toBe(500);
      }).pipe(Effect.ensuring(runtime.disposeEffect)),
    );
  });
});
