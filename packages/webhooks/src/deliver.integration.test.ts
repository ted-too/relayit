/**
 * Webhook Event delivery against a real database, with fakes only at DNS and outbound
 * HTTP: where the request goes, and how a URL that may not be requested ends.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import {
  organization,
  webhookEndpoint,
  webhookEvent,
  webhookEventDelivery,
} from "@repo/persistence/db/schema";
import { PublicHostLookup } from "@repo/public-url";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { typeid } from "typeid-js";
import { webhookDeliverHandler } from "./deliver";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

describe("webhookDeliverHandler (PostgreSQL)", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping Webhook delivery tests: TEST_DATABASE_URL is not set");
    // The PostgreSQL test is opt-in.
    test.skip("Webhook delivery", () => undefined);
    return;
  }

  /**
   * One attempt at a pending delivery to an Endpoint at `url`, whose host resolves to
   * `addresses`: the attempt's outcome, the requests that left, and the delivery's row.
   */
  const attempt = (url: string, addresses: readonly string[]) =>
    Effect.gen(function* () {
      const db = yield* DB;
      const organizationId = typeid("orgn").toString();
      yield* db.insert(organization).values({
        id: organizationId,
        name: "Webhooks",
        slug: `webhooks-${Bun.randomUUIDv7()}`,
      });
      const [endpoint] = yield* db
        .insert(webhookEndpoint)
        .values({ eventTypes: ["message.sent"], organizationId, signingSecret: "secret", url })
        .returning({ id: webhookEndpoint.id });
      const [event] = yield* db
        .insert(webhookEvent)
        .values({
          idempotencyId: Bun.randomUUIDv7(),
          organizationId,
          payload: { message_id: "msg_1" },
          type: "message.sent",
        })
        .returning({ id: webhookEvent.id });
      const [delivery] = yield* db
        .insert(webhookEventDelivery)
        .values({ webhookEndpointId: endpoint?.id ?? "", webhookEventId: event?.id ?? "" })
        .returning({ id: webhookEventDelivery.id });
      const deliveryId = delivery?.id ?? "";

      const requests: { readonly init: BunFetchRequestInit; readonly url: string }[] = [];
      const fetch = Object.assign(
        (input: string | URL | Request, init?: BunFetchRequestInit) => {
          requests.push({ init: init ?? {}, url: String(input) });
          return Promise.resolve(new Response("ok"));
        },
        { preconnect: globalThis.fetch.preconnect },
      );
      const execution = { attempt: 1, enqueuedAt: 0, id: "1-0" };
      const outcome = yield* webhookDeliverHandler
        .handle({ deliveryId }, execution)
        .pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
          Effect.provideService(PublicHostLookup, { resolve: () => Promise.resolve(addresses) }),
          Effect.result,
        );
      if (
        outcome._tag === "Failure" &&
        webhookDeliverHandler.classifyFailure(outcome.failure) === "terminal"
      ) {
        yield* (
          webhookDeliverHandler.onDeadLetter?.({ deliveryId }, execution, outcome.failure) ??
          Effect.void
        );
      }
      const [row] = yield* db
        .select({
          lastError: webhookEventDelivery.lastError,
          nextAttemptAt: webhookEventDelivery.nextAttemptAt,
          status: webhookEventDelivery.status,
        })
        .from(webhookEventDelivery)
        .where(eq(webhookEventDelivery.id, deliveryId));
      return { outcome, requests, row };
    }).pipe(Effect.provide(makeDbLive({ databaseUrl: testDatabaseUrl })));

  it.live("posts the signed event to the address its host resolved to, naming the host", () =>
    Effect.gen(function* () {
      const { outcome, requests, row } = yield* attempt("https://hooks.example.com/relayit?t=1", [
        "93.184.215.14",
      ]);

      expect(outcome._tag).toBe("Success");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.url).toBe("https://93.184.215.14/relayit?t=1");
      expect(requests[0]?.init).toMatchObject({
        headers: { host: "hooks.example.com", "webhook-signature": expect.any(String) },
        method: "POST",
        redirect: "manual",
        tls: { serverName: "hooks.example.com" },
      });
      expect(row).toMatchObject({ lastError: null, status: "delivered" });
    }),
  );

  it.live("sends nothing to a host that resolves to a private address, and tries again", () =>
    Effect.gen(function* () {
      for (const [url, addresses] of [
        ["https://hooks.example.com/relayit", ["10.0.0.5"]],
        ["https://hooks.example.com/relayit", ["93.184.215.14", "169.254.169.254"]],
        // A name that doesn't resolve reads the same.
        ["https://hooks.example.com/relayit", []],
        ["https://127.0.0.1/relayit", ["93.184.215.14"]],
      ] as const) {
        const { outcome, requests, row } = yield* attempt(url, addresses);

        expect(requests).toEqual([]);
        expect(outcome).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "WebhookDeliveryRetryableError" },
        });
        // Still pending, with why and when it is next tried; the attempts run out as for
        // any failing Endpoint, and the delivery is then dead-lettered.
        expect(row).toMatchObject({
          lastError: "Webhook Endpoint URL's host has no public address",
          nextAttemptAt: expect.any(Date),
          status: "pending",
        });
      }
    }),
  );

  it.live("dead-letters a delivery to a URL that could never be requested, saying why", () =>
    Effect.gen(function* () {
      for (const [url, lastError] of [
        ["http://hooks.example.com/relayit", "Webhook Endpoint URL is not an https URL"],
        ["file:///etc/passwd", "Webhook Endpoint URL is not an https URL"],
        [`https://${"a".repeat(254)}/relayit`, "Webhook Endpoint URL's hostname is too long"],
      ] as const) {
        const { outcome, requests, row } = yield* attempt(url, ["93.184.215.14"]);

        expect(requests).toEqual([]);
        expect(outcome).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "WebhookDeliveryTerminalError" },
        });
        expect(row).toMatchObject({ lastError, nextAttemptAt: null, status: "dead_letter" });
      }
    }),
  );
});
