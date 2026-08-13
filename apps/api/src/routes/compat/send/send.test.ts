import { describe, expect, test } from "bun:test";
import type {
  AcceptTransactionalEmailInput,
  acceptTransactionalEmail,
} from "@repo/channels/email/accept";
import { EmailProviderRegistry } from "@repo/channels/email/provider-registry";
import { Usage, type UsageService } from "@repo/channels/usage";
import { Jobs, type JobsService } from "@repo/jobs";
import { ObjectStorage, type ObjectStorageService } from "@repo/object-storage";
import type { Database } from "@repo/persistence/db/effect";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer, ManagedRuntime } from "effect";
import { HttpClient } from "effect/unstable/http";
import { Elysia } from "elysia";
import type { ApiAuth } from "../../../lib/auth";
import type { RunApiEffect } from "../../../lib/effect";
import { createLegacySendRoutes } from "./index";

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

const makeTestAuth = (input?: {
  readonly slug?: string;
  readonly valid?: boolean;
}): ApiAuth => ({
  auth: {
    api: {
      verifyApiKey: () =>
        Promise.resolve(
          input?.valid === false
            ? { error: { message: "Unauthorized" }, key: null, valid: false }
            : {
                error: null,
                key: { id: "key_test", referenceId: "org_test" },
                valid: true,
              }
        ),
    },
  } as ApiAuth["auth"],
  close: () => Promise.resolve(),
  db: {
    query: {
      organization: {
        findFirst: () =>
          Promise.resolve(
            input?.valid === false
              ? null
              : { id: "org_test", slug: input?.slug ?? "acme" }
          ),
      },
    },
  } as ApiAuth["db"],
});

const makeApp = (
  accept: typeof acceptTransactionalEmail,
  auth: ApiAuth = makeTestAuth()
) => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  const runEffect: RunApiEffect = runtime.runPromise;
  const app = new Elysia().use(createLegacySendRoutes(auth, runEffect, accept));
  return { app, runtime };
};

const postLegacy = async (
  app: { handle: (request: Request) => Response | Promise<Response> },
  path: string,
  body: unknown
): Promise<Response> =>
  await app.handle(
    new Request(`http://localhost${path}`, {
      body: JSON.stringify(body),
      headers: {
        "content-type": "application/json",
        "x-api-key": "test-key",
      },
      method: "POST",
    })
  );

describe("POST /send/:project/raw/email", () => {
  test("maps a legacy raw body to Accept and returns queued", () => {
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
          postLegacy(app, "/send/acme/raw/email", {
            from: "sender@acme.test",
            payload: { html: "<p>Hello</p>", subject: "Hello" },
            to: "recipient@example.com",
          })
        );
        const body = yield* Effect.promise(() => response.json());

        expect(response.status).toBe(201);
        expect(body).toEqual({ id: "msg_test", status: "queued" });
        expect(captured).toMatchObject({
          attribution: { kind: "project" },
          organizationId: "org_test",
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });

  test("returns 404 when the API key Project slug does not match the path", () => {
    const { app, runtime } = makeApp(
      () =>
        Effect.succeed({
          deliveryId: "edlv_test",
          messageId: "msg_test",
          replayed: false,
          stripped: [],
        }),
      makeTestAuth({ slug: "other" })
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          postLegacy(app, "/send/acme/raw/email", {
            from: "sender@acme.test",
            payload: { html: "<p>Hello</p>", subject: "Hello" },
            to: "recipient@example.com",
          })
        );
        const body = yield* Effect.promise(() => response.json());

        expect(response.status).toBe(404);
        expect(body).toEqual({
          details: [],
          message: "Project not found",
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });

  test("returns 401 for an invalid API key", () => {
    const { app, runtime } = makeApp(
      () =>
        Effect.succeed({
          deliveryId: "edlv_test",
          messageId: "msg_test",
          replayed: false,
          stripped: [],
        }),
      makeTestAuth({ valid: false })
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          postLegacy(app, "/send/acme/raw/email", {
            from: "sender@acme.test",
            payload: { html: "<p>Hello</p>", subject: "Hello" },
            to: "recipient@example.com",
          })
        );
        const body = yield* Effect.promise(() => response.json());

        expect(response.status).toBe(401);
        expect(body).toMatchObject({ message: "Unauthorized" });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });

  test("returns 400 when from is omitted and sandbox is unavailable", () => {
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
          postLegacy(app, "/send/acme/raw/email", {
            payload: { html: "<p>Hello</p>", subject: "Hello" },
            to: "recipient@example.com",
          })
        );
        const body = yield* Effect.promise(() => response.json());

        expect(response.status).toBe(400);
        expect(body).toMatchObject({
          message:
            "No sender identity available; pass from or provision Sandbox Domain",
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });
});

describe("POST /send/:project/template/email", () => {
  test("resolves template.slug and returns queued", () => {
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
          postLegacy(app, "/send/acme/template/email", {
            from: "sender@acme.test",
            template: { props: { name: "Ada" }, slug: "welcome" },
            to: "recipient@example.com",
          })
        );
        const body = yield* Effect.promise(() => response.json());

        expect(response.status).toBe(201);
        expect(body).toEqual({ id: "msg_test", status: "queued" });
        expect(captured?.email.content).toEqual({
          idOrSlug: "welcome",
          kind: "template",
          values: { name: "Ada" },
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });
});
