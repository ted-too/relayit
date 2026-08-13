import { describe, expect, test } from "bun:test";
import {
  type handleProviderWebhook,
  ProviderWebhookHandlerError,
} from "@repo/channels/email/deliverability";
import type { Database } from "@repo/persistence/db/effect";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer, ManagedRuntime } from "effect";
import { Elysia } from "elysia";
import type { RunApiEffect } from "../../lib/effect";
import { createProviderWebhookRoutes } from "./providers";

const makeTestLayer = () => Layer.succeed(DB, {} as Database);

const makeApp = (handle: typeof handleProviderWebhook) => {
  const runtime = ManagedRuntime.make(makeTestLayer());
  const runEffect = runtime.runPromise as RunApiEffect;
  const app = new Elysia().group("/webhooks", (group) =>
    group.use(createProviderWebhookRoutes(runEffect, handle))
  );
  return { app, runtime };
};

const postProviderWebhook = async (
  app: { handle: (request: Request) => Response | Promise<Response> },
  path: string,
  body: string
): Promise<Response> =>
  await app.handle(
    new Request(`http://localhost/webhooks/providers${path}`, {
      body,
      headers: { "content-type": "text/plain" },
      method: "POST",
    })
  );

describe("POST /webhooks/providers/:vendorId/:productId", () => {
  test("returns 404 when the handler reports not found", () => {
    const { app, runtime } = makeApp(() =>
      Effect.fail(
        new ProviderWebhookHandlerError({
          code: "not_found",
          message: "Webhook handler not found",
        })
      )
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          postProviderWebhook(app, "/aws/ses", "{}")
        );
        const body = yield* Effect.promise(() => response.json());

        expect(response.status).toBe(404);
        expect(body).toEqual({
          code: "not_found",
          message: "Webhook handler not found",
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });

  test("returns 200 when the handler accepts the notification", () => {
    let captured: {
      productId: string;
      rawBody: string;
      vendorId: string;
    } | null = null;

    const { app, runtime } = makeApp((input) => {
      captured = {
        productId: input.productId,
        rawBody: input.rawBody,
        vendorId: input.vendorId,
      };
      return Effect.succeed({ ok: true as const });
    });

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          postProviderWebhook(app, "/aws/ses", '{"Type":"Notification"}')
        );
        const body = yield* Effect.promise(() => response.json());

        expect(response.status).toBe(200);
        expect(body).toEqual({ ok: true });
        expect(captured).toEqual({
          productId: "ses",
          rawBody: '{"Type":"Notification"}',
          vendorId: "aws",
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });

  test("returns 400 when the handler reports a bad request", () => {
    const { app, runtime } = makeApp(() =>
      Effect.fail(
        new ProviderWebhookHandlerError({
          cause: new Error("bad sns"),
          code: "bad_request",
          message: "Provider webhook handling failed",
        })
      )
    );

    return Effect.runPromise(
      Effect.gen(function* () {
        const response = yield* Effect.promise(() =>
          postProviderWebhook(app, "/aws/ses", "not-json")
        );
        const body = yield* Effect.promise(() => response.json());

        expect(response.status).toBe(400);
        expect(body).toEqual({
          code: "bad_request",
          message: "Provider webhook handling failed",
        });
      }).pipe(Effect.ensuring(runtime.disposeEffect))
    );
  });
});
