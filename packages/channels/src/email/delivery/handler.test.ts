import { describe, expect, it } from "@effect/vitest";
import { Jobs, type JobsService } from "@repo/jobs";
import { ObjectStorage, type ObjectStorageService } from "@repo/object-storage";
import { type Database, DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import {
  MessageDeliveryRetryableError,
  MessageDeliveryTerminalError,
} from "../../messages/delivery";
import { Usage, type UsageService } from "../../usage";
import {
  EmailBackend,
  EmailBackendRejected,
  type EmailBackendService,
  EmailBackendUnavailable,
} from "../backend";
import { makeEmailDeliverHandler } from "./handler";

const unsupported = () => Effect.die("unused");

const verifiedRegistration = {
  id: "epid_test",
  region: "eu-central-1" as string | null,
  verificationStatus: "verified" as "not_verified" | "partially_verified" | "verified",
};

const baseDelivery = {
  bcc: null as string[] | null,
  cc: null as string[] | null,
  completedAt: null,
  customDomain: {
    fqdn: "example.com",
    id: "dom_test",
    isPaused: false,
    registration: verifiedRegistration as typeof verifiedRegistration | null,
  } as {
    fqdn: string;
    id: string;
    isPaused: boolean;
    registration: typeof verifiedRegistration | null;
  } | null,
  customDomainId: "dom_test",
  error: null,
  from: {
    address: "sender@example.com",
    normalized: "sender@example.com",
  },
  headers: {},
  html: "<p>Hi</p>",
  id: "edlv_test",
  message: {
    id: "msg_test",
    organizationAppEnvironmentId: "oenv_test",
    tags: null as Record<string, string> | null,
  },
  messageId: "msg_test",
  providerMessageId: null,
  replyTo: null as string[] | null,
  sandboxDomain: null as {
    registration: typeof verifiedRegistration | null;
    rootDomain: string;
  } | null,
  sandboxDomainId: null as string | null,
  startedAt: null,
  status: "queued" as "canceled" | "failed" | "queued" | "sending" | "sent" | "skipped",
  subject: "Hello",
  text: null as string | null,
  to: ["recipient@example.com"],
};

const makeDb = (overrides: {
  readonly contactId?: string;
  readonly delivery?: typeof baseDelivery | null;
  /** What a conditional update matches: the dead-letter path only fails an unfinished one. */
  readonly failedOnDeadLetter?: boolean;
  readonly orgSlug?: string;
  readonly suppressedEmails?: readonly string[];
}) => {
  const updates: unknown[] = [];
  const delivery = overrides.delivery === undefined ? baseDelivery : overrides.delivery;
  const suppressed = new Set(overrides.suppressedEmails ?? []);
  const inserts: unknown[] = [];

  const db: any = {
    insert: () => ({
      values: (values: unknown) => {
        inserts.push(values);
        return Effect.void;
      },
    }),
    query: {
      contact: {
        findFirst: () => Effect.succeed(overrides.contactId ? { id: overrides.contactId } : null),
      },
      emailAttachment: {
        findMany: () => Effect.succeed([]),
      },
      emailDelivery: {
        findFirst: () => Effect.succeed(delivery),
      },
      message: {
        findFirst: () =>
          Effect.succeed({ appEnvironment: { organizationId: "org_test" }, tags: null }),
      },
      organization: {
        findFirst: () =>
          Effect.succeed({
            slug: overrides.orgSlug ?? "acme",
          }),
      },
      organizationAppEnvironment: {
        findFirst: () => Effect.succeed({ organizationId: "org_test" }),
      },
    },
    select: () => ({
      from: () => ({
        where: () => Effect.succeed([...suppressed].map((email) => ({ email }))),
      }),
    }),
    transaction: <A, E, R>(body: (tx: typeof db) => Effect.Effect<A, E, R>) => body(db),
    update: () => ({
      set: (values: unknown) => ({
        where: () => {
          updates.push(values);
          return Object.assign(Effect.void, {
            returning: () =>
              Effect.succeed(overrides.failedOnDeadLetter ? [{ messageId: "msg_test" }] : []),
          });
        },
      }),
    }),
  };

  return { db: db as unknown as Database, inserts, updates };
};

const testLayer = (
  db: Database,
  options: {
    readonly send?: EmailBackendService["send"];
    readonly usage?: Partial<UsageService>;
  } = {},
) =>
  Layer.mergeAll(
    Layer.succeed(DB, db),
    Layer.succeed(Usage, {
      confirm: () => Effect.void,
      release: () => Effect.void,
      reserve: unsupported,
      ...options.usage,
    } satisfies UsageService),
    Layer.succeed(Jobs, {
      cancel: () => Effect.void,
      enqueue: () => Effect.void,
      schedule: () => Effect.void,
    } satisfies JobsService),
    Layer.succeed(ObjectStorage, {
      delete: unsupported,
      download: unsupported,
      exists: unsupported,
      signedDownloadUrl: unsupported,
      signedUploadUrl: unsupported,
      upload: unsupported,
    } satisfies ObjectStorageService),
    Layer.succeed(EmailBackend, {
      createIdentity: unsupported,
      defaultRegion: "eu-central-1",
      deleteIdentity: unsupported,
      ensureInfrastructure: unsupported,
      getIdentityStatus: unsupported,
      send: options.send ?? unsupported,
    } satisfies EmailBackendService),
  );

const emailDeliverHandler = makeEmailDeliverHandler({
  secret: "",
  webOrigin: "",
});

const payload = {
  billingUserId: "billing_test",
  deliveryId: "edlv_test",
  purpose: "transactional" as const,
  startDate: "2026-08-10T00:00:00.000Z",
};

const execution = { attempt: 1, enqueuedAt: Date.now(), id: "job_1" };

describe("emailDeliverHandler", () => {
  it.effect("no-ops when the Delivery is already sent", () => {
    const { db, updates } = makeDb({
      delivery: { ...baseDelivery, status: "sent" },
    });
    return emailDeliverHandler.handle(payload, execution).pipe(
      Effect.provide(testLayer(db)),
      Effect.map(() => {
        expect(updates).toEqual([]);
        return true;
      }),
    );
  });

  it.effect("marks paused domains failed and terminates", () => {
    const { db, updates } = makeDb({
      delivery: {
        ...baseDelivery,
        customDomain: {
          fqdn: "example.com",
          id: "dom_test",
          isPaused: true,
          registration: verifiedRegistration,
        },
      },
    });
    return emailDeliverHandler.handle(payload, execution).pipe(
      Effect.provide(testLayer(db)),
      Effect.flip,
      Effect.map((error) => {
        expect(error).toMatchObject({
          _tag: "MessageDeliveryTerminalError",
          stage: "domain",
        });
        expect(updates[0]).toMatchObject({ status: "failed" });
        return error;
      }),
    );
  });

  it.effect("skips when every recipient is suppressed", () => {
    const { db, updates } = makeDb({
      suppressedEmails: ["recipient@example.com"],
    });
    return emailDeliverHandler.handle(payload, execution).pipe(
      Effect.provide(testLayer(db)),
      Effect.flip,
      Effect.map((error) => {
        expect(error).toMatchObject({
          _tag: "MessageDeliveryTerminalError",
          stage: "suppressions",
        });
        expect(updates.some((update) => (update as { status?: string }).status === "skipped")).toBe(
          true,
        );
        return error;
      }),
    );
  });

  it.effect("stops when the sending domain is not verified with SES", () => {
    const { db } = makeDb({
      delivery: {
        ...baseDelivery,
        customDomain: {
          fqdn: "example.com",
          id: "dom_test",
          isPaused: false,
          registration: { ...verifiedRegistration, verificationStatus: "not_verified" },
        },
      },
    });
    return emailDeliverHandler.handle(payload, execution).pipe(
      Effect.provide(testLayer(db)),
      Effect.flip,
      Effect.map((error) => {
        expect(error).toMatchObject({
          _tag: "MessageDeliveryTerminalError",
          stage: "registration",
        });
        return error;
      }),
    );
  });

  it.effect("sends through the region the domain is registered in, as the sending Project", () => {
    const { db, updates } = makeDb({});
    let confirmed = false;
    let sentWith: Parameters<EmailBackendService["send"]>[0] | undefined;

    return emailDeliverHandler.handle(payload, execution).pipe(
      Effect.provide(
        testLayer(db, {
          send: (input) => {
            sentWith = input;
            return Effect.succeed({ providerMessageId: "ses_msg_1" });
          },
          usage: {
            confirm: () => {
              confirmed = true;
              return Effect.void;
            },
          },
        }),
      ),
      Effect.map(() => {
        expect(sentWith?.region).toBe("eu-central-1");
        expect(sentWith?.message.sender).toEqual({
          identityFqdn: "example.com",
          projectId: "org_test",
        });
        expect(confirmed).toBe(true);
        expect(updates).toContainEqual(
          expect.objectContaining({ providerMessageId: "ses_msg_1", status: "sent" }),
        );
        return true;
      }),
    );
  });

  it.effect("sends a domain registered before regions were recorded in the default region", () => {
    const { db } = makeDb({
      delivery: {
        ...baseDelivery,
        customDomain: {
          fqdn: "example.com",
          id: "dom_test",
          isPaused: false,
          registration: { ...verifiedRegistration, region: null },
        },
      },
    });
    let region: string | null | undefined;

    return emailDeliverHandler.handle(payload, execution).pipe(
      Effect.provide(
        testLayer(db, {
          send: (input) => {
            region = input.region;
            return Effect.succeed({ providerMessageId: "ses_msg_1" });
          },
        }),
      ),
      Effect.map(() => {
        // The backend reads a null region as its default one.
        expect(region).toBeNull();
        return true;
      }),
    );
  });

  it.effect("a Project Sending Pause pauses the Domain and fails terminally", () => {
    const { db, updates } = makeDb({});

    return emailDeliverHandler.handle(payload, execution).pipe(
      Effect.provide(
        testLayer(db, {
          send: ({ region }) =>
            Effect.fail(
              new EmailBackendRejected({
                reason: "project_sending_paused",
                region: region ?? "eu-central-1",
              }),
            ),
        }),
      ),
      Effect.flip,
      Effect.map((error) => {
        expect(error).toMatchObject({
          _tag: "MessageDeliveryTerminalError",
          stage: "send",
        });
        expect(emailDeliverHandler.classifyFailure(error)).toBe("terminal");
        expect(updates).toContainEqual({
          isPaused: true,
          pausedReason: "bad_reputation",
        });
        expect(updates).toContainEqual(
          expect.objectContaining({
            error: expect.objectContaining({ retryable: false }),
            status: "failed",
          }),
        );
        return true;
      }),
    );
  });

  it.effect("retries any other SES failure, leaving the Delivery sending", () => {
    const { db, updates } = makeDb({});

    return emailDeliverHandler.handle(payload, execution).pipe(
      Effect.provide(
        testLayer(db, {
          send: () => Effect.fail(new EmailBackendUnavailable({ region: "eu-central-1" })),
        }),
      ),
      Effect.flip,
      Effect.map((error) => {
        expect(error).toMatchObject({
          _tag: "MessageDeliveryRetryableError",
          stage: "send",
        });
        expect(emailDeliverHandler.classifyFailure(error)).toBe("retryable");
        expect(updates.map((update) => (update as { status?: string }).status)).toEqual([
          "sending",
        ]);
        return error;
      }),
    );
  });

  it.effect(
    "on dead letter, fails an unfinished Delivery with its reason and releases Usage",
    () => {
      let released = false;
      const { db, inserts, updates } = makeDb({ failedOnDeadLetter: true });
      const onDeadLetter = emailDeliverHandler.onDeadLetter;
      if (!onDeadLetter) {
        throw new Error("expected onDeadLetter");
      }
      return onDeadLetter(
        payload,
        execution,
        new MessageDeliveryRetryableError({
          deliveryId: "edlv_test",
          message: "SES send failed",
          stage: "send",
        }),
      ).pipe(
        Effect.provide(
          testLayer(db, {
            usage: {
              release: () => {
                released = true;
                return Effect.void;
              },
            },
          }),
        ),
        Effect.map(() => {
          expect(updates).toEqual([
            expect.objectContaining({
              error: { message: "SES send failed", retryable: false },
              status: "failed",
            }),
          ]);
          // No subscribed Webhook Endpoint, so no event row; the emit was attempted.
          expect(inserts).toEqual([]);
          expect(released).toBe(true);
          return true;
        }),
      );
    },
  );

  it.effect("on dead letter, leaves a finished Delivery as it is", () => {
    let released = false;
    const { db } = makeDb({ failedOnDeadLetter: false });
    const onDeadLetter = emailDeliverHandler.onDeadLetter;
    if (!onDeadLetter) {
      throw new Error("expected onDeadLetter");
    }
    return onDeadLetter(
      payload,
      execution,
      new MessageDeliveryTerminalError({
        deliveryId: "edlv_test",
        message: "No deliverable recipients after suppression",
        stage: "suppressions",
      }),
    ).pipe(
      Effect.provide(
        testLayer(db, {
          usage: {
            release: () => {
              released = true;
              return Effect.void;
            },
          },
        }),
      ),
      Effect.map(() => {
        expect(released).toBe(true);
        return true;
      }),
    );
  });

  it.effect("attaches List-Unsubscribe headers for marketing single-recipient sends", () => {
    let sentHeaders: Record<string, string> | null | undefined;
    const { db } = makeDb({
      contactId: "cont_test",
      orgSlug: "acme",
    });
    const handler = makeEmailDeliverHandler({
      secret: "test-secret",
      webOrigin: "https://app.example.com",
    });

    return handler
      .handle(
        {
          ...payload,
          purpose: "marketing",
          topicId: "topc_test",
        },
        execution,
      )
      .pipe(
        Effect.provide(
          testLayer(db, {
            send: ({ message }) => {
              sentHeaders = message.headers;
              return Effect.succeed({ providerMessageId: "pm_unsub" });
            },
          }),
        ),
        Effect.map(() => {
          expect(sentHeaders).toEqual(
            expect.objectContaining({
              "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
            }),
          );
          expect(sentHeaders?.["List-Unsubscribe"]).toContain(
            "https://app.example.com/unsubscribe/acme/cont_test?",
          );
          expect(sentHeaders?.["List-Unsubscribe"]).toContain("topic=topc_test");
          return true;
        }),
      );
  });
});
