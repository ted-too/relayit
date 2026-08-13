import { describe, expect, test } from "bun:test";
import type { EmailProviderFactory } from "@repo/channels/email/provider-adapter";
import {
  EmailProviderRegistry,
  type EmailProviderRegistryService,
} from "@repo/channels/email/provider-registry";
import type { NormalizedDeliveryEvent } from "@repo/channels/email/provider-webhook";
import { ProviderNotFound } from "@repo/channels/provider-errors";
import { Jobs, type JobsService } from "@repo/jobs";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import { handleProviderWebhook } from "./handle-provider-webhook";

const bounceEvent = {
  kind: "bounced",
  providerMessageId: "provider-message-id",
  raw: { bounceType: "Permanent" },
  recipients: ["bad@example.com"],
  suppress: true,
} satisfies NormalizedDeliveryEvent;

const makeFactory = (
  result:
    | {
        readonly events: readonly NormalizedDeliveryEvent[];
        readonly type: "events";
      }
    | { readonly type: "noop" }
) =>
  ({
    create: () => Effect.die("unused"),
    definition: {
      channel: "email" as const,
      credentialsSchema: {} as never,
      label: "SES",
      productId: "ses",
      typeId: "aws.ses" as const,
      vendorId: "aws",
    },
    webhooks: {
      handle: () => Effect.succeed(result),
    },
  }) satisfies EmailProviderFactory;

describe("handleProviderWebhook", () => {
  test("ingests delivery events from the provider adapter", async () => {
    const events: unknown[] = [];
    const factory = makeFactory({ events: [bounceEvent], type: "events" });
    const registry = {
      get: (typeId) =>
        typeId === "aws.ses"
          ? Effect.succeed(factory)
          : Effect.fail(new ProviderNotFound({ typeId })),
    } satisfies EmailProviderRegistryService;

    const db: any = {
      insert: () => ({
        values: (values: unknown) => {
          events.push(values);
          return Effect.void;
        },
      }),
      query: {
        emailDelivery: {
          findFirst: () =>
            Effect.succeed({
              customDomainId: "dom_test",
              id: "edlv_test",
              message: {
                id: "msg_test",
                organizationAppEnvironmentId: "oenv_test",
                tags: null,
              },
              messageId: "msg_test",
              providerId: "prov_test",
              providerMessageId: "provider-message-id",
              sandboxDomainId: null,
            }),
        },
        organizationAppEnvironment: {
          findFirst: () => Effect.succeed({ organizationId: "org_test" }),
        },
      },
      select: () => ({
        from: () => ({
          where: () => Effect.succeed([]),
        }),
      }),
      transaction: <A, E, R>(body: (tx: typeof db) => Effect.Effect<A, E, R>) =>
        body(db),
      update: () => ({
        set: () => ({
          where: () => Effect.void,
        }),
      }),
    };

    const jobs = {
      cancel: () => Effect.void,
      enqueue: () => Effect.void,
      schedule: () => Effect.void,
    } satisfies JobsService;

    const layer = Layer.mergeAll(
      Layer.succeed(DB, db),
      Layer.succeed(EmailProviderRegistry, registry),
      Layer.succeed(Jobs, jobs)
    );

    const result = await Effect.runPromise(
      handleProviderWebhook({
        headers: new Headers(),
        productId: "ses",
        rawBody: "{}",
        vendorId: "aws",
      }).pipe(Effect.provide(layer))
    );

    expect(result).toEqual({ ok: true });
    expect(events).toEqual([
      expect.objectContaining({
        emailDeliveryId: "edlv_test",
        kind: "bounced",
      }),
    ]);
  });

  test("returns not_found for an unknown provider type", async () => {
    const registry = {
      get: (typeId) => Effect.fail(new ProviderNotFound({ typeId })),
    } satisfies EmailProviderRegistryService;

    const jobs = {
      cancel: () => Effect.void,
      enqueue: () => Effect.void,
      schedule: () => Effect.void,
    } satisfies JobsService;

    const layer = Layer.mergeAll(
      Layer.succeed(DB, {} as never),
      Layer.succeed(EmailProviderRegistry, registry),
      Layer.succeed(Jobs, jobs)
    );

    const error = await Effect.runPromise(
      handleProviderWebhook({
        headers: new Headers(),
        productId: "x",
        rawBody: "{}",
        vendorId: "nope",
      }).pipe(Effect.provide(layer), Effect.flip)
    );

    expect(error.code).toBe("not_found");
  });
});
