import { describe, expect, it } from "@effect/vitest";
import { Usage, type UsageService } from "@repo/channels/usage";
import { Jobs, type JobsService } from "@repo/jobs";
import { ObjectStorage, type ObjectStorageService } from "@repo/object-storage";
import type { Database } from "@repo/persistence/db/effect";
import { DB } from "@repo/persistence/db/effect";
import { AwsSnsValidationError } from "@repo/provider-aws/errors";
import type { handleSesNotification } from "@repo/provider-aws/email/webhooks";
import { Effect, FiberSet, Layer } from "effect";
import { HttpClient } from "effect/http";
import { Elysia } from "elysia";
import type { ApiServices, RunApiEffect } from "../../lib/effect";
import { createSesNotificationRoutes } from "./ses";

// The route reaches only DB and Jobs; the other api services are never touched.
const makeApp = (handle: typeof handleSesNotification, db: Partial<Database> = {}) =>
  Effect.gen(function* () {
    const runEffect: RunApiEffect = yield* FiberSet.makeRuntimePromise<ApiServices>();
    return new Elysia().use(createSesNotificationRoutes(runEffect, handle));
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(DB, db as Database),
        Layer.succeed(Jobs, {} as JobsService),
        Layer.succeed(HttpClient.HttpClient, {} as HttpClient.HttpClient),
        Layer.succeed(ObjectStorage, {} as ObjectStorageService),
        Layer.succeed(Usage, {} as UsageService),
      ),
    ),
  );

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
  it.live("accepts a notification with nothing to record", () => {
    let received: string | undefined;

    return Effect.gen(function* () {
      const app = yield* makeApp((rawBody) => {
        received = rawBody;
        return Effect.succeed({ type: "noop" } as const);
      });
      const response = yield* Effect.promise(() => post(app, '{"Type":"Notification"}'));

      expect(response.status).toBe(200);
      expect(yield* Effect.promise(() => response.json())).toEqual({ ok: true });
      expect(received).toBe('{"Type":"Notification"}');
    });
  });

  it.live("refuses a message that fails SNS's checks, which SNS does not retry", () => {
    return Effect.gen(function* () {
      const app = yield* makeApp(() => Effect.fail(new AwsSnsValidationError({})));
      const response = yield* Effect.promise(() => post(app, "not-json"));

      expect(response.status).toBe(400);
      expect(yield* Effect.promise(() => response.json())).toEqual({
        code: "bad_request",
        message: "SES notification handling failed",
      });
    });
  });

  it.live("answers 500 when an outcome cannot be recorded, so SNS retries it", () => {
    return Effect.gen(function* () {
      const app = yield* makeApp(
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
      const response = yield* Effect.promise(() => post(app, "{}"));

      expect(response.status).toBe(500);
    });
  });
});
