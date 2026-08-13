import { describe, expect, test } from "bun:test";
import {
  type AcceptTransactionalEmailInput,
  type acceptTransactionalEmail,
  EmailAcceptInfrastructureError,
  EmailAcceptRejected,
} from "@repo/channels/email/accept";
import { EmailProviderRegistry } from "@repo/channels/email/provider-registry";
import {
  Usage,
  UsageLimitExceeded,
  type UsageService,
} from "@repo/channels/usage";
import { Jobs, type JobsService } from "@repo/jobs";
import { ObjectStorage, type ObjectStorageService } from "@repo/object-storage";
import type { Database } from "@repo/persistence/db/effect";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpClient } from "effect/unstable/http";
import { Elysia } from "elysia";
import type { ApiAuth } from "../../lib/auth";
import type { RunApiEffect } from "../../lib/effect";
import { createEmailRoutes } from "./email";

const MESSAGE_ID_PATTERN = /^msg_/;

const makeTestLayer = () => {
  const unsupported = () => Effect.die("unsupported");
  const usage = {
    confirm: () => Effect.void,
    release: () => Effect.void,
    remeter: () => Effect.void,
    reserve: () =>
      Effect.succeed({
        billingUserId: "billing_test",
        dailyLimit: null,
        monthlyLimit: null,
        periodEnd: new Date("2026-09-01T00:00:00.000Z"),
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
      }),
  } satisfies UsageService;
  const jobs = {
    cancel: () => Effect.void,
    enqueue: () => Effect.void,
    schedule: () => Effect.void,
  } satisfies JobsService;
  const storage = {
    delete: unsupported,
    download: unsupported,
    exists: () => Effect.succeed(false),
    signedDownloadUrl: unsupported,
    signedUploadUrl: unsupported,
    upload: unsupported,
  } satisfies ObjectStorageService;

  return Layer.mergeAll(
    Layer.succeed(DB, {} as Database),
    Layer.succeed(Usage, usage),
    Layer.succeed(Jobs, jobs),
    Layer.succeed(ObjectStorage, storage),
    Layer.succeed(
      HttpClient.HttpClient,
      {} as Effect.Success<typeof HttpClient.HttpClient>
    ),
    Layer.succeed(EmailProviderRegistry, {
      get: () => Effect.die("unused"),
    })
  );
};

const makeTestAuth = (): ApiAuth => ({
  auth: {
    api: {
      verifyApiKey: () =>
        Promise.resolve({
          error: null,
          key: { id: "key_test", referenceId: "org_test" },
          valid: true,
        }),
    },
  } as ApiAuth["auth"],
  close: () => Promise.resolve(),
  db: {
    query: {
      member: {
        findFirst: () => Promise.resolve({ userId: "user_test" }),
      },
      organization: {
        findFirst: () => Promise.resolve({ id: "org_test" }),
      },
    },
  } as ApiAuth["db"],
});

const makeApp = (accept: typeof acceptTransactionalEmail) => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  const runEffect: RunApiEffect = runtime.runPromise;
  const app = new Elysia().group("/messages", (group) =>
    group.use(createEmailRoutes(makeTestAuth(), runEffect, accept))
  );
  return { app, runtime };
};

const postEmail = async (
  app: { handle: (request: Request) => Response | Promise<Response> },
  body: unknown,
  headers: Record<string, string> = {}
): Promise<Response> =>
  await app.handle(
    new Request("http://localhost/messages/email", {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-api-key": "test-key",
        ...headers,
      },
      method: "POST",
    })
  );

describe("POST /messages/email", () => {
  test("maps a valid request to accept input and returns an accepted message id", () => {
    let captured: AcceptTransactionalEmailInput | undefined;
    const { app, runtime } = makeApp((input) => {
      captured = input;
      return Effect.succeed({
        deliveryId: "edlv_test",
        messageId: "msg_test",
        replayed: false,
        stripped: [],
      });
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          postEmail(app, {
            from: "sender@example.com",
            html: "<p>Hello</p>",
            subject: "Hello",
            to: "recipient@example.com",
          })
        );
        const body = yield* Effect.promise(() => response.json());

        expect(response.status).toBe(201);
        expect(body).toEqual({ id: expect.stringMatching(MESSAGE_ID_PATTERN) });
        expect(captured).toMatchObject({
          attribution: { kind: "project" },
          email: {
            attachments: [],
            bcc: [],
            cc: [],
            content: {
              html: "<p>Hello</p>",
              kind: "inline",
              subject: "Hello",
            },
            from: {
              address: "sender@example.com",
              normalized: "sender@example.com",
            },
            headers: {},
            replyTo: [],
            to: [{ email: "recipient@example.com" }],
          },
          organizationId: "org_test",
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });

  test("maps template wire fields and App / Environment headers into accept input", () => {
    let captured: AcceptTransactionalEmailInput | undefined;
    const { app, runtime } = makeApp((input) => {
      captured = input;
      return Effect.succeed({
        deliveryId: "edlv_test",
        messageId: "msg_test",
        replayed: false,
        stripped: [],
      });
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          postEmail(
            app,
            {
              from: "sender@example.com",
              reply_to: ["support@example.com"],
              subject: "Welcome",
              template: {
                id: "welcome",
                variables: { name: "Ada" },
              },
              to: {
                email: "recipient@example.com",
                first_name: "Ada",
                properties: { plan: "pro" },
              },
            },
            {
              app: "web",
              environment: "production",
              "idempotency-key": "idem_test",
            }
          )
        );
        const body = yield* Effect.promise(() => response.json());

        expect(response.status).toBe(201);
        expect(body).toEqual({ id: "msg_test" });
        expect(captured).toMatchObject({
          attribution: {
            app: "web",
            environment: "production",
            kind: "appEnvironment",
          },
          email: {
            content: {
              idOrSlug: "welcome",
              kind: "template",
              subjectOverride: "Welcome",
              values: { name: "Ada" },
            },
            replyTo: ["support@example.com"],
            to: [
              {
                email: "recipient@example.com",
                firstName: "Ada",
                properties: { plan: "pro" },
              },
            ],
          },
          idempotencyKey: "idem_test",
          organizationId: "org_test",
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });

  test("rejects unpaired App / Environment headers", () => {
    const { app, runtime } = makeApp(() =>
      Effect.succeed({
        deliveryId: "edlv_test",
        messageId: "msg_test",
        replayed: false,
        stripped: [],
      })
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          postEmail(
            app,
            {
              from: "sender@example.com",
              html: "<p>Hello</p>",
              subject: "Hello",
              to: "recipient@example.com",
            },
            { app: "web" }
          )
        );
        const body = yield* Effect.promise(() => response.json());

        expect(response.status).toBe(400);
        expect(body).toMatchObject({ code: "invalid_app_environment" });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });

  test("includes stripped recipients in the response", () => {
    const { app, runtime } = makeApp(() =>
      Effect.succeed({
        deliveryId: "edlv_test",
        messageId: "msg_test",
        replayed: false,
        stripped: [{ email: "suppressed@example.com", reason: "suppression" }],
      })
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          postEmail(app, {
            from: "sender@example.com",
            html: "<p>Hello</p>",
            subject: "Hello",
            to: ["ok@example.com", "suppressed@example.com"],
          })
        );
        const body = yield* Effect.promise(() => response.json());

        expect(response.status).toBe(201);
        expect(body).toEqual({
          id: "msg_test",
          stripped: [
            { email: "suppressed@example.com", reason: "suppression" },
          ],
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });

  test("maps EmailAcceptRejected to 422", () => {
    const { app, runtime } = makeApp(() =>
      Effect.fail(
        new EmailAcceptRejected({
          code: "invalid_from_address",
          message: "bad from",
        })
      )
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          postEmail(app, {
            from: "sender@example.com",
            html: "<p>Hello</p>",
            subject: "Hello",
            to: "recipient@example.com",
          })
        );
        const body = yield* Effect.promise(() => response.json());

        expect(response.status).toBe(422);
        expect(body).toEqual({
          code: "invalid_from_address",
          message: "bad from",
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });

  test("maps UsageLimitExceeded to 429", () => {
    const { app, runtime } = makeApp(() =>
      Effect.fail(
        new UsageLimitExceeded({
          deliveryId: "edlv_test",
          providerKind: "managed",
          retryAt: new Date(Date.now() + 60_000),
          window: "daily",
        })
      )
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          postEmail(app, {
            from: "sender@example.com",
            html: "<p>Hello</p>",
            subject: "Hello",
            to: "recipient@example.com",
          })
        );
        const body = (yield* Effect.promise(() => response.json())) as {
          code?: string;
          retry_after_seconds?: number;
        };

        expect(response.status).toBe(429);
        expect(body).toMatchObject({
          code: "daily_limit_exceeded",
        });
        expect(body.retry_after_seconds).toBeGreaterThan(0);
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });

  test("maps unexpected failures to a generic 500 without leaking internals", () => {
    const { app, runtime } = makeApp(() =>
      Effect.fail(
        new EmailAcceptInfrastructureError({
          cause: new Error("boom"),
          operation: "content",
          organizationId: "org_test",
        })
      )
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          postEmail(app, {
            from: "sender@example.com",
            html: "<p>Hello</p>",
            subject: "Hello",
            to: "recipient@example.com",
          })
        );
        const body = yield* Effect.promise(() => response.json());

        expect(response.status).toBe(500);
        expect(body).toEqual({
          code: "internal_server_error",
          message: "Failed to accept email message.",
        });
        expect(JSON.stringify(body)).not.toContain("boom");
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });
});
