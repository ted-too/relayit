import { describe, expect, test } from "bun:test";
import { Jobs, type JobsService } from "@repo/jobs";
import { ObjectStorage, type ObjectStorageService } from "@repo/object-storage";
import {
  type OpenedProviderCredentials,
  ProviderCredentialsVault,
} from "@repo/persistence/crypto/provider-credentials";
import { DB } from "@repo/persistence/db/effect";
import { Redis, type RedisService } from "@repo/redis";
import { Effect, Layer } from "effect";
import { MessageDeliveryTerminalError } from "../../messages/delivery";
import { Usage, UsageLimitExceeded, type UsageService } from "../../usage";
import type {
  EmailProviderAdapter,
  EmailProviderFactory,
} from "../provider-adapter";
import {
  EmailProviderRegistry,
  type EmailProviderRegistryService,
} from "../provider-registry";
import { makeEmailDeliverHandler } from "./handler";

const unsupported = () => Effect.die("unused");
const openedCredentials = {
  encrypted: {},
  unencrypted: {},
} as OpenedProviderCredentials;

const makeProvider = (input: {
  readonly id: string;
  readonly scope?: "platform" | "project";
}) => ({
  credentials: { ciphertext: "sealed", keyVersion: 1, nonce: "n" },
  id: input.id,
  productId: "ses",
  scope: input.scope ?? ("platform" as const),
  vendorId: "aws",
});

const makeIdentity = (input: {
  readonly failoverEligible?: boolean;
  readonly failoverPriority?: number;
  readonly id: string;
  readonly isActive?: boolean;
  readonly provider: ReturnType<typeof makeProvider>;
}) => ({
  failoverEligible: input.failoverEligible ?? false,
  failoverPriority: input.failoverPriority ?? 0,
  id: input.id,
  isActive: input.isActive ?? false,
  provider: input.provider,
  verificationStatus: "verified",
});

const baseDelivery = {
  bcc: null as string[] | null,
  cc: null as string[] | null,
  completedAt: null,
  customDomain: null as { id: string; isPaused: boolean } | null,
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
  providerId: null,
  providerMessageId: null,
  replyTo: null as string[] | null,
  sandboxDomainId: null as string | null,
  startedAt: null,
  status: "queued" as
    | "canceled"
    | "failed"
    | "queued"
    | "sending"
    | "sent"
    | "skipped",
  subject: "Hello",
  text: null as string | null,
  to: ["recipient@example.com"],
};

const makeDb = (overrides: {
  readonly contactId?: string;
  readonly delivery?: typeof baseDelivery | null;
  readonly identities?: readonly ReturnType<typeof makeIdentity>[];
  readonly organizationId?: string;
  readonly orgSlug?: string;
  readonly suppressedEmails?: readonly string[];
  readonly updates?: unknown[];
}) => {
  const updates = overrides.updates ?? [];
  const delivery =
    overrides.delivery === undefined ? baseDelivery : overrides.delivery;
  const suppressed = new Set(overrides.suppressedEmails ?? []);
  const identities = overrides.identities ?? [];

  const db: any = {
    query: {
      contact: {
        findFirst: () =>
          Effect.succeed(
            overrides.contactId ? { id: overrides.contactId } : null
          ),
      },
      emailAttachment: {
        findMany: () => Effect.succeed([]),
      },
      emailDelivery: {
        findFirst: () => Effect.succeed(delivery),
      },
      organization: {
        findFirst: () =>
          Effect.succeed({
            slug: overrides.orgSlug ?? "acme",
          }),
      },
      organizationAppEnvironment: {
        findFirst: () =>
          Effect.succeed({
            organizationId: overrides.organizationId ?? "org_test",
          }),
      },
    },
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: () => Effect.succeed(identities),
        }),
        where: () =>
          Effect.succeed([...suppressed].map((email) => ({ email }))),
      }),
    }),
    transaction: <A, E, R>(body: (tx: typeof db) => Effect.Effect<A, E, R>) =>
      body(db),
    update: () => ({
      set: (values: unknown) => ({
        where: () => {
          updates.push(values);
          return Effect.void;
        },
      }),
    }),
  };

  return { db: db as unknown as Effect.Success<typeof DB>, updates };
};

const adapterDefinition = {
  channel: "email" as const,
  credentialsSchema: {} as never,
  label: "test",
  productId: "ses",
  typeId: "aws.ses" as const,
  vendorId: "aws",
};

const makeSendFactory = (
  send: (
    message?: Parameters<EmailProviderAdapter["send"]>[0]
  ) => Effect.Effect<{ readonly providerMessageId: string }, unknown>,
  createInput?: (input: { providerId: string }) => void
) =>
  ({
    create: (input) => {
      createInput?.(input);
      return Effect.succeed({
        checkConnection: Effect.succeed(true),
        createIdentity: unsupported,
        definition: adapterDefinition,
        deleteIdentity: unsupported,
        getIdentityStatus: unsupported,
        send: (message) =>
          send(message) as ReturnType<EmailProviderAdapter["send"]>,
      } as EmailProviderAdapter);
    },
    definition: adapterDefinition,
  }) satisfies EmailProviderFactory;

const testLayer = (
  db: Effect.Success<typeof DB>,
  options: {
    readonly allowByProvider?: ReadonlyMap<string, boolean>;
    /** After recordFailure, these providers report open (allow=0) so failover proceeds. */
    readonly openCircuitAfterFailure?: ReadonlySet<string>;
    readonly registry?: {
      get: EmailProviderRegistryService["get"];
    };
    readonly usage?: Partial<UsageService>;
    readonly vaultOpen?: () => Effect.Effect<OpenedProviderCredentials>;
  } = {}
) => {
  const allowByProvider = options.allowByProvider;
  const openAfterFailure = new Set(options.openCircuitAfterFailure ?? []);
  const opened = new Set<string>();
  const redisStub = {
    acknowledge: unsupported,
    append: unsupported,
    autoClaim: unsupported,
    createConsumerGroup: unsupported,
    evaluateNumber: ({
      args,
      keys,
    }: {
      args: readonly string[];
      keys: readonly string[];
    }) => {
      const key = keys[0] ?? "";
      const providerId = key.replace("relayit:breaker:provider:", "");
      if (args.length === 3) {
        // RECORD_FAILURE
        if (openAfterFailure.has(providerId)) {
          opened.add(providerId);
        }
        return Effect.succeed(1);
      }
      if (args.length === 2) {
        // ALLOW
        if (opened.has(providerId)) {
          return Effect.succeed(0);
        }
        if (allowByProvider) {
          return Effect.succeed(
            (allowByProvider.get(providerId) ?? true) ? 1 : 0
          );
        }
        return Effect.succeed(1);
      }
      // RECORD_SUCCESS
      opened.delete(providerId);
      return Effect.succeed(1);
    },
    evaluateString: unsupported,
    ping: Effect.void,
    readGroup: unsupported,
    sortedSetAdd: unsupported,
    sortedSetRemove: unsupported,
  } satisfies RedisService;

  return Layer.mergeAll(
    Layer.succeed(DB, db),
    Layer.succeed(Usage, {
      confirm: () => Effect.void,
      release: () => Effect.void,
      remeter: () => Effect.void,
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
    Layer.succeed(ProviderCredentialsVault, {
      open: options.vaultOpen ?? (() => Effect.succeed(openedCredentials)),
      seal: unsupported,
    }),
    Layer.succeed(
      EmailProviderRegistry,
      options.registry ?? {
        get: unsupported,
      }
    ),
    Layer.succeed(Redis, redisStub)
  );
};

const emailDeliverHandler = makeEmailDeliverHandler({
  secret: "",
  webOrigin: "",
});

const payload = {
  billingUserId: "billing_test",
  deliveryId: "edlv_test",
  providerKind: "managed" as const,
  purpose: "transactional" as const,
  startDate: "2026-08-10T00:00:00.000Z",
};

const execution = { attempt: 1, enqueuedAt: Date.now(), id: "job_1" };

const primaryProvider = makeProvider({ id: "prov_primary" });
const standbyProvider = makeProvider({
  id: "prov_standby",
  scope: "project",
});
const primaryIdentity = makeIdentity({
  id: "ident_primary",
  isActive: true,
  provider: primaryProvider,
});
const standbyIdentity = makeIdentity({
  failoverEligible: true,
  failoverPriority: 1,
  id: "ident_standby",
  provider: standbyProvider,
});

describe("emailDeliverHandler", () => {
  test("no-ops when the Delivery is already sent", () => {
    const { db, updates } = makeDb({
      delivery: { ...baseDelivery, status: "sent" },
    });
    return Effect.runPromise(
      emailDeliverHandler.handle(payload, execution).pipe(
        Effect.provide(testLayer(db)),
        Effect.map(() => {
          expect(updates).toEqual([]);
          return true;
        })
      )
    );
  });

  test("marks paused domains failed and terminates", () => {
    const { db, updates } = makeDb({
      delivery: {
        ...baseDelivery,
        customDomain: { id: "dom_test", isPaused: true },
      },
    });
    return Effect.runPromise(
      emailDeliverHandler.handle(payload, execution).pipe(
        Effect.provide(testLayer(db)),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            _tag: "MessageDeliveryTerminalError",
            stage: "domain",
          });
          expect(updates[0]).toMatchObject({ status: "failed" });
          return error;
        })
      )
    );
  });

  test("skips when every recipient is suppressed", () => {
    const { db, updates } = makeDb({
      suppressedEmails: ["recipient@example.com"],
    });
    return Effect.runPromise(
      emailDeliverHandler.handle(payload, execution).pipe(
        Effect.provide(testLayer(db)),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            _tag: "MessageDeliveryTerminalError",
            stage: "suppressions",
          });
          expect(
            updates.some(
              (update) => (update as { status?: string }).status === "skipped"
            )
          ).toBe(true);
          return error;
        })
      )
    );
  });

  test("confirms Usage and marks sent on provider success", () => {
    const { db, updates } = makeDb({
      identities: [primaryIdentity],
    });
    let confirmed = false;
    const factory = makeSendFactory(() =>
      Effect.succeed({ providerMessageId: "ses_msg_1" })
    );

    return Effect.runPromise(
      emailDeliverHandler.handle(payload, execution).pipe(
        Effect.provide(
          testLayer(db, {
            registry: {
              get: () => Effect.succeed(factory),
            },
            usage: {
              confirm: () => {
                confirmed = true;
                return Effect.void;
              },
            },
          })
        ),
        Effect.map(() => {
          expect(confirmed).toBe(true);
          expect(
            updates.some(
              (update) =>
                (update as { status?: string; providerMessageId?: string })
                  .status === "sent" &&
                (update as { providerMessageId?: string }).providerMessageId ===
                  "ses_msg_1"
            )
          ).toBe(true);
          return true;
        })
      )
    );
  });

  test("remeters Usage when failover provider kind differs", () => {
    const { db } = makeDb({
      identities: [primaryIdentity, standbyIdentity],
    });
    const remeterKinds: string[] = [];
    let sendCount = 0;
    const factory = makeSendFactory(() => {
      sendCount += 1;
      if (sendCount === 1) {
        return Effect.fail(new Error("primary down"));
      }
      return Effect.succeed({ providerMessageId: "ses_failover" });
    });

    return Effect.runPromise(
      emailDeliverHandler.handle(payload, execution).pipe(
        Effect.provide(
          testLayer(db, {
            openCircuitAfterFailure: new Set(["prov_primary"]),
            registry: {
              get: () => Effect.succeed(factory),
            },
            usage: {
              remeter: ({ providerKind }) => {
                remeterKinds.push(providerKind);
                return Effect.void;
              },
            },
          })
        ),
        Effect.map(() => {
          expect(remeterKinds).toContain("byo");
          expect(sendCount).toBe(2);
          return true;
        })
      )
    );
  });

  test("fails over when the primary provider circuit is open", () => {
    const { db, updates } = makeDb({
      identities: [primaryIdentity, standbyIdentity],
    });
    let sentVia: string | undefined;
    const factory = makeSendFactory(
      () => Effect.succeed({ providerMessageId: "ses_standby" }),
      (input) => {
        sentVia = input.providerId;
      }
    );

    return Effect.runPromise(
      emailDeliverHandler.handle(payload, execution).pipe(
        Effect.provide(
          testLayer(db, {
            allowByProvider: new Map([
              ["prov_primary", false],
              ["prov_standby", true],
            ]),
            registry: {
              get: () => Effect.succeed(factory),
            },
          })
        ),
        Effect.map(() => {
          expect(sentVia).toBe("prov_standby");
          expect(
            updates.some(
              (update) => (update as { status?: string }).status === "sent"
            )
          ).toBe(true);
          return true;
        })
      )
    );
  });

  test("marks failed and returns retryable when every provider fails", () => {
    const { db, updates } = makeDb({
      identities: [primaryIdentity],
    });
    const factory = makeSendFactory(() =>
      Effect.fail(new Error("ses unavailable"))
    );

    return Effect.runPromise(
      emailDeliverHandler.handle(payload, execution).pipe(
        Effect.provide(
          testLayer(db, {
            // Circuit stays closed so leaveActive=false → retryable on active.
            allowByProvider: new Map([["prov_primary", true]]),
            registry: {
              get: () => Effect.succeed(factory),
            },
          })
        ),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            _tag: "MessageDeliveryRetryableError",
            stage: "send",
          });
          // Either failed-after-all-standby or early retryable on active.
          expect(
            updates.some(
              (update) =>
                (update as { status?: string }).status === "failed" ||
                (update as { status?: string }).status === "sending"
            )
          ).toBe(true);
          return error;
        })
      )
    );
  });

  test("surfaces remeter UsageLimitExceeded as leave-active failure then retries", () => {
    const { db } = makeDb({
      identities: [primaryIdentity],
    });
    return Effect.runPromise(
      emailDeliverHandler.handle(payload, execution).pipe(
        Effect.provide(
          testLayer(db, {
            usage: {
              remeter: () =>
                Effect.fail(
                  new UsageLimitExceeded({
                    deliveryId: "edlv_test",
                    providerKind: "managed",
                    retryAt: new Date("2026-08-11T00:00:00.000Z"),
                    window: "daily",
                  })
                ),
            },
          })
        ),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            _tag: "MessageDeliveryRetryableError",
          });
          return error;
        })
      )
    );
  });

  test("releases Usage on dead letter", () => {
    let released = false;
    const { db } = makeDb({});
    const onDeadLetter = emailDeliverHandler.onDeadLetter;
    if (!onDeadLetter) {
      throw new Error("expected onDeadLetter");
    }
    return Effect.runPromise(
      onDeadLetter(
        payload,
        execution,
        new MessageDeliveryTerminalError({
          deliveryId: "edlv_test",
          message: "done",
          stage: "test",
        })
      ).pipe(
        Effect.provide(
          testLayer(db, {
            usage: {
              release: () => {
                released = true;
                return Effect.void;
              },
            },
          })
        ),
        Effect.map(() => {
          expect(released).toBe(true);
          return true;
        })
      )
    );
  });

  test("attaches List-Unsubscribe headers for marketing single-recipient sends", () => {
    let sentHeaders: Record<string, string> | null | undefined;
    const { db } = makeDb({
      contactId: "cont_test",
      identities: [primaryIdentity],
      orgSlug: "acme",
    });
    const factory = makeSendFactory((message) => {
      sentHeaders = message?.headers;
      return Effect.succeed({ providerMessageId: "pm_unsub" });
    });
    const handler = makeEmailDeliverHandler({
      secret: "test-secret",
      webOrigin: "https://app.example.com",
    });

    return Effect.runPromise(
      handler
        .handle(
          {
            ...payload,
            purpose: "marketing",
            topicId: "topc_test",
          },
          execution
        )
        .pipe(
          Effect.provide(
            testLayer(db, {
              registry: { get: () => Effect.succeed(factory) },
            })
          ),
          Effect.map(() => {
            expect(sentHeaders).toEqual(
              expect.objectContaining({
                "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
              })
            );
            expect(sentHeaders?.["List-Unsubscribe"]).toContain(
              "https://app.example.com/unsubscribe/acme/cont_test?"
            );
            expect(sentHeaders?.["List-Unsubscribe"]).toContain(
              "topic=topc_test"
            );
            return true;
          })
        )
    );
  });
});
