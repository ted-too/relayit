import { handleProviderWebhook } from "@repo/channels/email/deliverability";
import { Effect } from "effect";
import { Elysia, status } from "elysia";
import { z } from "zod";
import type { RunApiEffect } from "../../lib/effect";

const providerWebhookParamsSchema = z.object({
  productId: z.string().min(1),
  vendorId: z.string().min(1),
});

export const createProviderWebhookRoutes = (
  runEffect: RunApiEffect,
  handle = handleProviderWebhook
) =>
  new Elysia({
    prefix: "/providers",
  }).post(
    "/:vendorId/:productId",
    async ({ params, request }) => {
      const rawBody = await request.text();
      return runEffect(
        handle({
          headers: request.headers,
          productId: params.productId,
          rawBody,
          vendorId: params.vendorId,
        }).pipe(
          Effect.map(() => status(200, { ok: true as const })),
          Effect.catch((error) =>
            Effect.gen(function* () {
              switch (error._tag) {
                case "ProviderWebhookHandlerError":
                  switch (error.code) {
                    case "not_found":
                      return status(404, {
                        code: error.code,
                        message: error.message,
                      });
                    case "bad_request":
                      return status(400, {
                        code: error.code,
                        message: error.message,
                      });
                    default: {
                      const _exhaustive: never = error.code;
                      return _exhaustive;
                    }
                  }
                default:
                  yield* Effect.logError(
                    "Provider webhook handling failed"
                  ).pipe(
                    Effect.annotateLogs({
                      error: error._tag,
                      productId: params.productId,
                      vendorId: params.vendorId,
                    })
                  );
                  return status(500, {
                    code: "internal_server_error",
                    message: "Provider webhook handling failed",
                  });
              }
            })
          )
        ),
        { signal: request.signal }
      );
    },
    {
      params: providerWebhookParamsSchema,
    }
  );
