import { describe, expect, it } from "@effect/vitest";
import type { DatabaseTransaction } from "@repo/persistence/db/effect";
import { Effect } from "effect";
import { createWebhookEndpoint, updateWebhookEndpoint } from "./endpoints";

// A refused URL never reaches the database: touching this transaction would throw.
const untouched = {} as DatabaseTransaction;

const REFUSED = [
  "http://hooks.example.com/relayit",
  "file:///proc/self/environ",
  "hooks.example.com/relayit",
  "https://127.0.0.1/relayit",
  "https://169.254.169.254/latest/meta-data",
  "https://[::1]/relayit",
  `https://${"a".repeat(254)}/relayit`,
];

describe("a Webhook Endpoint's URL", () => {
  it.effect("is refused on create unless it is an https URL of a public host", () =>
    Effect.gen(function* () {
      for (const url of REFUSED) {
        const error = yield* Effect.flip(
          createWebhookEndpoint(untouched, {
            enabled: true,
            eventTypes: ["message.sent"],
            organizationId: "org_1",
            url,
          }),
        );
        expect(error).toMatchObject({ _tag: "WebhookManagementError", code: "invalid_url" });
      }
    }),
  );

  it.effect("is refused the same way on update", () =>
    Effect.gen(function* () {
      for (const url of REFUSED) {
        const error = yield* Effect.flip(
          updateWebhookEndpoint(untouched, { endpointId: "whkep_1", organizationId: "org_1", url }),
        );
        expect(error).toMatchObject({ _tag: "WebhookManagementError", code: "invalid_url" });
      }
    }),
  );
});
