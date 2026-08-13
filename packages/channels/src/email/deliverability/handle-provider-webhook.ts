import { DB } from "@repo/persistence/db/effect";
import { Data, Effect } from "effect";
import { makeProviderTypeId } from "../../provider-type";
import { EmailProviderRegistry } from "../provider-registry";
import { ingestDeliveryEvents } from "./notifications";

export class ProviderWebhookHandlerError extends Data.TaggedError(
  "ProviderWebhookHandlerError"
)<{
  readonly cause?: unknown;
  readonly code: "bad_request" | "not_found";
  readonly message: string;
}> {}

export const handleProviderWebhook = (input: {
  readonly headers: Headers;
  readonly productId: string;
  readonly rawBody: string;
  readonly vendorId: string;
}) =>
  Effect.gen(function* () {
    const registry = yield* EmailProviderRegistry;
    const db = yield* DB;
    const typeId = makeProviderTypeId(input.vendorId, input.productId);

    const factory = yield* registry.get(typeId).pipe(
      Effect.mapError(
        () =>
          new ProviderWebhookHandlerError({
            code: "not_found",
            message: "Webhook handler not found",
          })
      )
    );

    const webhooks = factory.webhooks;
    if (!webhooks) {
      return yield* new ProviderWebhookHandlerError({
        code: "not_found",
        message: "Webhook handler not found",
      });
    }

    const result = yield* webhooks
      .handle({
        headers: input.headers,
        rawBody: input.rawBody,
      })
      .pipe(
        Effect.mapError(
          (cause) =>
            new ProviderWebhookHandlerError({
              cause,
              code: "bad_request",
              message: "Provider webhook handling failed",
            })
        )
      );

    if (result.type === "events") {
      yield* ingestDeliveryEvents(db, { events: result.events }).pipe(
        Effect.mapError(
          (cause) =>
            new ProviderWebhookHandlerError({
              cause,
              code: "bad_request",
              message: "Provider webhook handling failed",
            })
        )
      );
    }

    return { ok: true as const };
  });
