import { describe, expect, test } from "bun:test";
import { Jobs, type JobsService } from "@repo/jobs";
import type { Database } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import { ingestDeliveryEvents } from "./notifications";

const delivery = {
  customDomainId: "dom_test",
  id: "edlv_test",
  message: {
    id: "msg_test",
    organizationAppEnvironmentId: "oenv_test",
    tags: null as Record<string, string> | null,
  },
  messageId: "msg_test",
  providerId: "prov_test",
  providerMessageId: "provider-message-id",
  sandboxDomainId: null as string | null,
};

const makeDb = (options: {
  readonly delivery?: typeof delivery | null;
  readonly events?: unknown[];
  readonly organizationId?: string;
  readonly suppressions?: unknown[];
}) => {
  const events = options.events ?? [];
  const suppressions = options.suppressions ?? [];
  const found = options.delivery === undefined ? delivery : options.delivery;

  const db: any = {
    insert: () => ({
      values: (values: unknown) => {
        events.push(values);
        return Effect.void;
      },
    }),
    query: {
      emailDelivery: {
        findFirst: () => Effect.succeed(found),
      },
      organizationAppEnvironment: {
        findFirst: () =>
          Effect.succeed({
            organizationId: options.organizationId ?? "org_test",
          }),
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
      set: (values: unknown) => ({
        where: () => {
          suppressions.push(values);
          return Effect.void;
        },
      }),
    }),
  };

  return {
    db: db as Database,
    events,
    suppressions,
  };
};

const testLayer = () => {
  const jobs = {
    cancel: () => Effect.void,
    enqueue: () => Effect.void,
    schedule: () => Effect.void,
  } satisfies JobsService;

  return Layer.succeed(Jobs, jobs);
};

describe("ingestDeliveryEvents", () => {
  test("hard bounce records a Delivery Event and suppresses at severity all", async () => {
    const { db, events, suppressions } = makeDb({});

    await Effect.runPromise(
      ingestDeliveryEvents(db, {
        events: [
          {
            kind: "bounced",
            providerMessageId: "provider-message-id",
            raw: { bounceType: "Permanent" },
            recipients: ["bad@example.com"],
            suppress: true,
          },
        ],
      }).pipe(Effect.provide(testLayer()))
    );

    expect(events).toEqual([
      {
        customDomainId: "dom_test",
        data: { bounceType: "Permanent" },
        emailDeliveryId: "edlv_test",
        kind: "bounced",
        providerId: "prov_test",
        sandboxDomainId: null,
      },
    ]);
    expect(suppressions).toEqual([
      expect.objectContaining({
        suppressionReason: "hard_bounce",
        suppressionSeverity: "all",
      }),
    ]);
  });

  test("complaint records a Delivery Event and suppresses at severity marketing", async () => {
    const { db, events, suppressions } = makeDb({});

    await Effect.runPromise(
      ingestDeliveryEvents(db, {
        events: [
          {
            kind: "complained",
            providerMessageId: "provider-message-id",
            raw: { complaintFeedbackType: "abuse" },
            recipients: ["annoyed@example.com"],
            suppress: true,
          },
        ],
      }).pipe(Effect.provide(testLayer()))
    );

    expect(events).toEqual([
      {
        customDomainId: "dom_test",
        data: { complaintFeedbackType: "abuse" },
        emailDeliveryId: "edlv_test",
        kind: "complained",
        providerId: "prov_test",
        sandboxDomainId: null,
      },
    ]);
    expect(suppressions).toEqual([
      expect.objectContaining({
        suppressionReason: "complaint",
        suppressionSeverity: "marketing",
      }),
    ]);
  });

  test("soft bounce records a Delivery Event without Suppression", async () => {
    const { db, events, suppressions } = makeDb({});

    await Effect.runPromise(
      ingestDeliveryEvents(db, {
        events: [
          {
            kind: "bounced",
            providerMessageId: "provider-message-id",
            raw: { bounceType: "Transient" },
            recipients: ["temp@example.com"],
            suppress: false,
          },
        ],
      }).pipe(Effect.provide(testLayer()))
    );

    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(
      expect.objectContaining({
        kind: "bounced",
      })
    );
    expect(suppressions).toEqual([]);
  });

  test("unknown provider message id is a no-op", async () => {
    const { db, events, suppressions } = makeDb({ delivery: null });

    await Effect.runPromise(
      ingestDeliveryEvents(db, {
        events: [
          {
            kind: "bounced",
            providerMessageId: "missing-provider-message",
            raw: {},
            recipients: ["bad@example.com"],
            suppress: true,
          },
        ],
      }).pipe(Effect.provide(testLayer()))
    );

    expect(events).toEqual([]);
    expect(suppressions).toEqual([]);
  });
});
