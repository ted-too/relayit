/**
 * Adding and removing a Domain against a real Postgres: who ends up holding it, whether it
 * ends up registered and checked, and that it goes with its last link and takes its SES
 * identity along. SES, public DNS and the job queue are the boundaries stubbed.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { JobEnqueueError, Jobs, type JobsService } from "@repo/jobs";
import { SELF_HOSTED_LIMITS } from "@repo/persistence/auth/plans";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import { migrateDatabase } from "@repo/persistence/db/migrate";
import {
  contact,
  customDomain,
  emailDelivery,
  emailDeliveryEvent,
  emailDomainRegistration,
  message,
  organization,
  organizationAppEnvironment,
  organizationDomain,
  removedDomainIdentity,
  sandboxDomain,
  user,
  userChannel,
  webhookEndpoint,
  webhookEvent,
} from "@repo/persistence/db/schema";
import { and, count, eq, or, sql } from "drizzle-orm";
import { Effect, Layer, Schedule } from "effect";
import { typeid } from "typeid-js";
import { EmailBackend, EmailBackendIdentityConflict, EmailBackendUnavailable } from "../backend";
import { DnsLookups } from "../dns-lookups";
import { EmailManagedDns } from "../managed-dns";
import { ingestDeliveryEvents } from "../deliverability/notifications";
import { createOwnershipToken, ownershipChallengeValue } from "./dns";
import { emailDeleteDomainIdentityHandler } from "./handlers";
import type { EmailDeleteDomainIdentityPayload } from "./jobs";
import { verifyCustomDomainOwnership } from "../verification/custom-identity";
import {
  emailVerifyCustomDomainHandler,
  emailVerifyOwnershipHandler,
} from "../verification/handlers";
import {
  CLAIM_TTL_MS,
  createCustomDomain,
  deleteCustomDomain,
  removeDeletedProjectDomains,
  removeUnlinkedDomains,
} from "./lifecycle";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

describe("Domain lifecycle (PostgreSQL)", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping Domain lifecycle tests: TEST_DATABASE_URL is not set");
    // The PostgreSQL test is opt-in.
    test.skip("createCustomDomain", () => undefined);
    return;
  }

  /**
   * SES, public DNS and the queue as each test sets them; what was scheduled, cancelled and
   * enqueued, by job, the SES identities the account holds (`identities`, FQDN to DKIM selector,
   * which a test may also fill with one Relayit did not make), those created and deleted,
   * and the TXT values published
   * in DNS. `beforeKeyLoad` runs as a Domain's DKIM key is read, which an add does between
   * writing a claim and registering the Domain; `beforeCreateIdentity` runs inside each
   * registration, as SES is called.
   */
  const boundaries = (
    options: {
      readonly beforeCreateIdentity?: () => Effect.Effect<void>;
      readonly beforeKeyLoad?: () => Effect.Effect<void>;
      readonly databaseUrl?: string;
      readonly failCancel?: boolean;
      readonly failCreateIdentity?: () => boolean;
      readonly failEnqueueFor?: () => string | undefined;
      readonly failSchedule?: () => boolean;
    } = {},
  ) => {
    const scheduled: { readonly name: string; readonly payload: unknown }[] = [];
    /** When each of `scheduled` is due, in the same order. */
    const scheduledAt: number[] = [];
    const published = new Set<string>();
    const cancelled: { readonly name: string; readonly payload: unknown }[] = [];
    const enqueued: { readonly name: string; readonly payload: unknown }[] = [];
    const deletedIdentities: { readonly fqdn: string; readonly region: string | null }[] = [];
    const createdIdentities: string[] = [];
    // The SES account as SES keeps it: one identity to an FQDN, signing with one selector.
    const identities = new Map<string, string>();
    const layer = Layer.mergeAll(
      Layer.succeed(EmailBackend, {
        createIdentity: ({ dkimSelector, fqdn, region }) =>
          options.failCreateIdentity?.()
            ? Effect.fail(
                new EmailBackendUnavailable({
                  cause: "SES is down",
                  region: region ?? "eu-central-1",
                }),
              )
            : (options.beforeCreateIdentity?.() ?? Effect.void).pipe(
                Effect.andThen(
                  Effect.suspend(() => {
                    const existing = identities.get(fqdn);
                    if (existing !== undefined && existing !== dkimSelector) {
                      return Effect.fail(
                        new EmailBackendIdentityConflict({
                          fqdn,
                          region: region ?? "eu-central-1",
                        }),
                      );
                    }
                    identities.set(fqdn, dkimSelector);
                    createdIdentities.push(fqdn);
                    return Effect.succeed({ mailFrom: { domain: `send.${fqdn}`, records: [] } });
                  }),
                ),
              ),
        defaultRegion: "eu-central-1",
        deleteIdentity: ({ dkimSelector, fqdn, region }) =>
          Effect.sync(() => {
            if (identities.get(fqdn) !== dkimSelector) {
              return false;
            }
            identities.delete(fqdn);
            deletedIdentities.push({ fqdn, region });
            return true;
          }),
        ensureInfrastructure: () => Effect.void,
        getIdentityStatus: () => Effect.die("unused"),
        getProjectSendingStatus: () => Effect.die("unused"),
        send: () => Effect.die("unused"),
      }),
      Layer.succeed(DnsLookups, {
        detectProvider: () => Promise.resolve("cloudflare"),
        evaluate: ({ value }) => Promise.resolve({ matches: published.has(value), warnings: [] }),
      }),
      Layer.succeed(Jobs, {
        cancel: ((contract: { readonly name: string }, payload?: unknown) => {
          if (options.failCancel) {
            return Effect.fail(
              new JobEnqueueError({
                cause: "Redis is down",
                jobName: contract.name,
                stage: "cancel",
              }),
            );
          }
          cancelled.push({ name: contract.name, payload });
          return Effect.void;
        }) as JobsService["cancel"],
        enqueue: ((contract: { readonly name: string }, payload: { readonly fqdn?: string }) => {
          if (payload.fqdn !== undefined && payload.fqdn === options.failEnqueueFor?.()) {
            return Effect.fail(
              new JobEnqueueError({ cause: "refused", jobName: contract.name, stage: "outbox" }),
            );
          }
          enqueued.push({ name: contract.name, payload });
          return Effect.void;
        }) as JobsService["enqueue"],
        schedule: ((contract: { readonly name: string }, payload: unknown, at?: number) => {
          if (options.failSchedule?.()) {
            return Effect.fail(
              new JobEnqueueError({
                cause: "Redis is down",
                jobName: contract.name,
                stage: "schedule",
              }),
            );
          }
          scheduled.push({ name: contract.name, payload });
          scheduledAt.push(at ?? Number.NaN);
          return Effect.void;
        }) as JobsService["schedule"],
      }),
      EmailManagedDns.noop(),
      Layer.effect(
        SymmetricCrypto,
        Effect.gen(function* () {
          const crypto = yield* SymmetricCrypto;
          return {
            ...crypto,
            decrypt: (value: string) =>
              (options.beforeKeyLoad?.() ?? Effect.void).pipe(
                Effect.andThen(crypto.decrypt(value)),
              ),
          };
        }),
      ).pipe(
        Layer.provide(
          SymmetricCrypto.live(parseBetterAuthSecrets("1:lifecycle-test-secret-0123456789")),
        ),
      ),
    ).pipe(Layer.provideMerge(makeDbLive({ databaseUrl: options.databaseUrl ?? testDatabaseUrl })));
    return {
      cancelled,
      createdIdentities,
      deletedIdentities,
      enqueued,
      identities,
      layer,
      published,
      scheduled,
      scheduledAt,
    };
  };

  const insertProject = Effect.fn(function* () {
    const db = yield* DB;
    const id = typeid("orgn").toString();
    // A Billing User whose Plan sets no Domain limit; the limit has its own tests.
    const billingUserId = `user_${id}`;
    yield* db
      .insert(user)
      .values({ email: `${billingUserId}@example.test`, id: billingUserId, name: "Billing" });
    yield* db.insert(userChannel).values({
      channelType: "email",
      limits: SELF_HOSTED_LIMITS.email,
      userId: billingUserId,
    });
    yield* db
      .insert(organization)
      .values({ billingUserId, id, name: "Domains", slug: `domains-${id}` });
    return id;
  });

  const linkOf = Effect.fn(function* (customDomainId: string, organizationId: string) {
    const db = yield* DB;
    return yield* db.query.organizationDomain.findFirst({
      where: { customDomainId, organizationId },
    });
  });

  const linksOf = Effect.fn(function* (customDomainId: string) {
    const db = yield* DB;
    return yield* db.query.organizationDomain.findMany({
      columns: { organizationId: true, ownershipVerificationStatus: true },
      where: { customDomainId },
    });
  });

  /** Runs the ownership check for one Project's link, as the worker's job does. */
  const checkOwnership = Effect.fn(function* (customDomainId: string, organizationId: string) {
    const db = yield* DB;
    const domain = yield* db.query.customDomain.findFirst({ where: { id: customDomainId } });
    if (!domain) {
      return yield* Effect.die("Domain is gone");
    }
    return yield* verifyCustomDomainOwnership({ customDomain: domain, db, organizationId });
  });

  /** Publishes the TXT record that proves a Project's claim. */
  const publishProof = Effect.fn(function* (
    published: Set<string>,
    customDomainId: string,
    organizationId: string,
  ) {
    const link = yield* linkOf(customDomainId, organizationId);
    if (!link) {
      return yield* Effect.die("No claim to prove");
    }
    published.add(ownershipChallengeValue(link.ownershipToken));
  });

  /** A Domain held by one Project with a claim on it by each of `claims` others. */
  const claimedDomain = Effect.fn(function* (claims: number) {
    const holderId = yield* insertProject();
    const fqdn = `${Bun.randomUUIDv7()}.example.test`;
    const { customDomainId } = yield* createCustomDomain({ fqdn, organizationId: holderId });
    const claimantIds: string[] = [];
    for (let claim = 0; claim < claims; claim += 1) {
      const claimantId = yield* insertProject();
      expect(yield* createCustomDomain({ fqdn, organizationId: claimantId })).toEqual({
        customDomainId,
        kind: "claim",
      });
      claimantIds.push(claimantId);
    }
    return { claimantIds, customDomainId, fqdn, holderId };
  });

  /** A Delivery a Project sent from a Domain, with the outcome SES reported for it. */
  const sentFrom = Effect.fn(function* (input: {
    readonly customDomainId: string;
    readonly fqdn: string;
    readonly organizationId: string;
  }) {
    const db = yield* DB;
    const messageId = typeid("msg").toString();
    const [environment] = yield* db
      .insert(organizationAppEnvironment)
      .values({ organizationId: input.organizationId })
      .onConflictDoNothing()
      .returning({ id: organizationAppEnvironment.id });
    const environmentId =
      environment?.id ??
      (yield* db.query.organizationAppEnvironment.findFirst({
        columns: { id: true },
        where: { organizationId: input.organizationId },
      }))?.id;
    if (!environmentId) {
      return yield* Effect.die("The Project has an App Environment");
    }
    yield* db.insert(message).values({
      id: messageId,
      organizationAppEnvironmentId: environmentId,
      purpose: "transactional",
    });
    const [delivery] = yield* db
      .insert(emailDelivery)
      .values({
        customDomainId: input.customDomainId,
        from: { address: `hello@${input.fqdn}`, normalized: `hello@${input.fqdn}` },
        messageId,
        providerMessageId: `ses-${Bun.randomUUIDv7()}`,
        status: "sent",
        subject: "Hi",
        text: "Hi",
        to: ["to@example.com"],
      })
      .returning();
    if (!delivery) {
      return yield* Effect.die("The Delivery was written");
    }
    yield* db.insert(emailDeliveryEvent).values({
      customDomainId: input.customDomainId,
      emailDeliveryId: delivery.id,
      kind: "delivered",
    });
    return delivery;
  });

  /** A Project's Messages with their Deliveries and events, as its history reads. */
  const historyOf = Effect.fn(function* (organizationId: string) {
    const db = yield* DB;
    return yield* db
      .select({ delivery: emailDelivery, event: emailDeliveryEvent, message })
      .from(message)
      .innerJoin(
        organizationAppEnvironment,
        eq(organizationAppEnvironment.id, message.organizationAppEnvironmentId),
      )
      .innerJoin(emailDelivery, eq(emailDelivery.messageId, message.id))
      .leftJoin(emailDeliveryEvent, eq(emailDeliveryEvent.emailDeliveryId, emailDelivery.id))
      .where(eq(organizationAppEnvironment.organizationId, organizationId))
      .orderBy(emailDelivery.id, emailDeliveryEvent.id);
  });

  const dkimKeyOf = Effect.fn(function* (customDomainId: string) {
    const db = yield* DB;
    const domain = yield* db.query.customDomain.findFirst({
      columns: { dkimPrivateKey: true, dkimPublicKey: true },
      where: { id: customDomainId },
    });
    return domain ?? (yield* Effect.die("Domain is gone"));
  });

  const domainOf = Effect.fn(function* (fqdn: string) {
    const db = yield* DB;
    return yield* db.query.customDomain.findFirst({
      columns: { id: true, lastCheckedAt: true, verificationStatus: true },
      where: { fqdn },
      with: {
        dnsRecords: { columns: { purpose: true } },
        organizations: { columns: { organizationId: true, ownershipVerificationStatus: true } },
        registration: { columns: { region: true } },
      },
    });
  });

  const selectorOf = Effect.fn(function* (customDomainId: string) {
    const db = yield* DB;
    const domain = yield* db.query.customDomain.findFirst({
      columns: { dkimSelector: true },
      where: { id: customDomainId },
    });
    return domain?.dkimSelector ?? (yield* Effect.die("The Domain exists"));
  });

  /** A Domain its holder added while SES was down: held, with no registration. */
  const unregisteredDomain = Effect.fn(function* (ses: { down: boolean }) {
    const holderId = yield* insertProject();
    const fqdn = `${Bun.randomUUIDv7()}.example.test`;
    ses.down = true;
    yield* Effect.flip(createCustomDomain({ fqdn, organizationId: holderId }));
    ses.down = false;
    const domain = yield* domainOf(fqdn);
    if (!domain || domain.registration) {
      return yield* Effect.die("The Domain was written, unregistered");
    }
    return { customDomainId: domain.id, fqdn, holderId };
  });

  /** Runs the identity deletes enqueued for `fqdn`, as the worker does once they commit. */
  const runIdentityDeletes = Effect.fn(function* (
    enqueued: readonly { readonly name: string; readonly payload: unknown }[],
    fqdn: string,
  ) {
    const payloads = enqueued
      .filter((job) => job.name === "email.delete-domain-identity")
      .map((job) => job.payload as EmailDeleteDomainIdentityPayload)
      .filter((payload) => payload.fqdn === fqdn);
    for (const payload of payloads) {
      yield* emailDeleteDomainIdentityHandler.handle(payload, {
        attempt: 1,
        enqueuedAt: Date.now(),
        id: "job_delete_identity",
      });
    }
    return payloads;
  });

  it.live("a Sandbox Domain's root, or a name under it, can't be added", () => {
    const { createdIdentities, enqueued, layer, scheduled } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const projectId = yield* insertProject();
      const root = `${Bun.randomUUIDv7()}.sandbox.test`;
      yield* db.insert(sandboxDomain).values({
        cloudflareZoneId: "zone",
        dkimPrivateKey: "private",
        dkimPublicKey: "public",
        dkimSelector: "relayit",
        // Stored as configured; the FQDN a Project types arrives lowercased.
        rootDomain: root.toUpperCase(),
      });

      for (const fqdn of [root, `mail.${root}`, `a.b.${root}`]) {
        expect(
          yield* Effect.flip(createCustomDomain({ fqdn, organizationId: projectId })),
        ).toMatchObject({ _tag: "CustomDomainReserved", fqdn });
      }
      expect(
        yield* db
          .select({ fqdn: customDomain.fqdn })
          .from(customDomain)
          .where(sql`${customDomain.fqdn} like ${`%${root}`}`),
      ).toEqual([]);
      expect({ createdIdentities, enqueued, scheduled }).toEqual({
        createdIdentities: [],
        enqueued: [],
        scheduled: [],
      });

      // A name that only ends with the root's letters is another domain, added as usual.
      const other = yield* createCustomDomain({
        fqdn: `x${root}`,
        organizationId: projectId,
      });
      expect(other.kind).toBe("created");
    }).pipe(Effect.provide(layer));
  });

  it.live("a Domain already on a Sandbox Domain's root is not claimed or finished", () => {
    const { createdIdentities, enqueued, layer, scheduled } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const holderId = yield* insertProject();
      const claimantId = yield* insertProject();
      const root = `${Bun.randomUUIDv7()}.sandbox.test`;
      // As a deployment holds it if the root was added before it was refused: a row with its
      // holder's link and no registration.
      const [held] = yield* db
        .insert(customDomain)
        .values({
          dkimPrivateKey: "private",
          dkimPublicKey: "public",
          dkimSelector: "s",
          fqdn: root,
        })
        .returning({ id: customDomain.id });
      const customDomainId = held?.id ?? "";
      yield* db.insert(organizationDomain).values({
        customDomainId,
        organizationId: holderId,
        ownershipToken: createOwnershipToken(),
        ownershipVerificationStatus: "verified",
      });
      yield* db.insert(sandboxDomain).values({
        cloudflareZoneId: "zone",
        dkimPrivateKey: "private",
        dkimPublicKey: "public",
        dkimSelector: "relayit",
        rootDomain: root,
      });

      for (const organizationId of [claimantId, holderId]) {
        expect(
          yield* Effect.flip(createCustomDomain({ fqdn: root, organizationId })),
        ).toMatchObject({ _tag: "CustomDomainReserved" });
      }

      expect(
        yield* db
          .select({ organizationId: organizationDomain.organizationId })
          .from(organizationDomain)
          .where(eq(organizationDomain.customDomainId, customDomainId)),
      ).toEqual([{ organizationId: holderId }]);
      expect(
        yield* db
          .select({ id: emailDomainRegistration.id })
          .from(emailDomainRegistration)
          .where(eq(emailDomainRegistration.customDomainId, customDomainId)),
      ).toEqual([]);
      expect({ createdIdentities, enqueued, scheduled }).toEqual({
        createdIdentities: [],
        enqueued: [],
        scheduled: [],
      });
    }).pipe(Effect.provide(layer));
  });

  it.live("a removal queued for a Sandbox Domain's FQDN leaves its identity alone", () => {
    const { deletedIdentities, identities, layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const root = `${Bun.randomUUIDv7()}.sandbox.test`;
      const other = `${Bun.randomUUIDv7()}.example.test`;
      yield* db.insert(sandboxDomain).values({
        cloudflareZoneId: "zone",
        dkimPrivateKey: "private",
        dkimPublicKey: "public",
        dkimSelector: "relayit",
        rootDomain: root,
      });

      for (const fqdn of [root, other]) {
        // Even a job naming the selector the identity signs with.
        identities.set(fqdn, "relayit");
        yield* emailDeleteDomainIdentityHandler.handle(
          { dkimSelector: "relayit", fqdn, region: null },
          { attempt: 1, enqueuedAt: Date.now(), id: fqdn },
        );
      }

      expect(deletedIdentities).toEqual([{ fqdn: other, region: null }]);
    }).pipe(Effect.provide(layer));
  });

  it.live("a Domain named as an SES identity Relayit did not make is refused, and it stays", () => {
    const { createdIdentities, deletedIdentities, enqueued, identities, layer, scheduled } =
      boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const projectId = yield* insertProject();
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;
      // Made by hand in the SES console, or by another system on the same account.
      identities.set(fqdn, "selector1");

      for (const _attempt of [1, 2]) {
        expect(
          yield* Effect.flip(createCustomDomain({ fqdn, organizationId: projectId })),
        ).toMatchObject({ _tag: "CustomDomainIdentityConflict", fqdn });
        // The Domain the add wrote goes with the refusal, and its removal deletes nothing.
        expect(yield* domainOf(fqdn)).toBeUndefined();
        yield* runIdentityDeletes(enqueued, fqdn);
      }

      expect(enqueued.map((job) => job.name)).toEqual([
        "email.delete-domain-identity",
        "email.delete-domain-identity",
      ]);
      expect(identities.get(fqdn)).toBe("selector1");
      // Nothing was deleted, so each removal's record stays: were an identity of one of
      // those Domains to turn up, an add of the FQDN could still delete it.
      expect(
        yield* db
          .select({ id: removedDomainIdentity.id })
          .from(removedDomainIdentity)
          .where(eq(removedDomainIdentity.fqdn, fqdn)),
      ).toHaveLength(2);
      expect({ createdIdentities, deletedIdentities, scheduled }).toEqual({
        createdIdentities: [],
        deletedIdentities: [],
        scheduled: [],
      });
    }).pipe(Effect.provide(layer));
  });

  it.live("an unregistered Domain is not finished onto an identity Relayit did not make", () => {
    const ses = { down: false };
    const { deletedIdentities, enqueued, identities, layer } = boundaries({
      failCreateIdentity: () => ses.down,
    });
    return Effect.gen(function* () {
      const { customDomainId, fqdn, holderId } = yield* unregisteredDomain(ses);
      const claimantId = yield* insertProject();
      identities.set(fqdn, "selector1");

      // Its holder finishing it and another Project claiming it are refused alike, and as
      // with any registration that failed the Domain and the claim stay as they were.
      for (const organizationId of [holderId, claimantId]) {
        expect(yield* Effect.flip(createCustomDomain({ fqdn, organizationId }))).toMatchObject({
          _tag: "CustomDomainIdentityConflict",
          customDomainId,
        });
      }
      expect(yield* domainOf(fqdn)).toMatchObject({ id: customDomainId, registration: null });
      expect(yield* linksOf(customDomainId)).toHaveLength(2);

      // Removing the Domain leaves the identity: it never signed with the Domain's selector.
      for (const organizationId of [holderId, claimantId]) {
        yield* deleteCustomDomain({ customDomainId, organizationId });
      }
      expect(yield* domainOf(fqdn)).toBeUndefined();
      expect(yield* runIdentityDeletes(enqueued, fqdn)).toHaveLength(1);
      expect(identities.get(fqdn)).toBe("selector1");
      expect(deletedIdentities).toEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.live("a registration SES made the identity for before it failed is finished with it", () => {
    const ses = { down: false };
    const { createdIdentities, deletedIdentities, identities, layer } = boundaries({
      failCreateIdentity: () => ses.down,
    });
    return Effect.gen(function* () {
      const { customDomainId, fqdn, holderId } = yield* unregisteredDomain(ses);
      // SES made the identity, and the answer or the registration's commit was lost.
      identities.set(fqdn, yield* selectorOf(customDomainId));

      expect(yield* createCustomDomain({ fqdn, organizationId: holderId })).toEqual({
        customDomainId,
        kind: "existing",
      });

      expect(yield* domainOf(fqdn)).toMatchObject({ registration: { region: "eu-central-1" } });
      expect({ createdIdentities, deletedIdentities }).toEqual({
        createdIdentities: [fqdn],
        deletedIdentities: [],
      });
    }).pipe(Effect.provide(layer));
  });

  it.live("a removed Domain whose identity was never deleted does not keep its FQDN", () => {
    const { deletedIdentities, enqueued, identities, layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const holderId = yield* insertProject();
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;
      const first = yield* createCustomDomain({ fqdn, organizationId: holderId });
      yield* deleteCustomDomain({ customDomainId: first.customDomainId, organizationId: holderId });
      // Its delete job is a dead letter: never run. The identity is recorded as the removed
      // Domain's until something deletes it.
      const recorded = db
        .select({ dkimSelector: removedDomainIdentity.dkimSelector })
        .from(removedDomainIdentity)
        .where(eq(removedDomainIdentity.fqdn, fqdn));
      expect(yield* recorded).toEqual([{ dkimSelector: identities.get(fqdn) }]);

      const second = yield* createCustomDomain({ fqdn, organizationId: holderId });

      expect(second.kind).toBe("created");
      expect(deletedIdentities).toEqual([{ fqdn, region: "eu-central-1" }]);
      expect(identities.get(fqdn)).toBe(yield* selectorOf(second.customDomainId));
      expect(yield* recorded).toEqual([]);

      // And a job that does run takes its record with it.
      yield* deleteCustomDomain({
        customDomainId: second.customDomainId,
        organizationId: holderId,
      });
      expect(yield* recorded).toHaveLength(1);
      yield* runIdentityDeletes(enqueued.slice(1), fqdn);
      expect(yield* recorded).toEqual([]);
      expect(identities.has(fqdn)).toBe(false);
    }).pipe(Effect.provide(layer));
  });

  it.live(
    "a Domain whose first check could not be scheduled is checked from the next start",
    () => {
      let redisDown = false;
      const ses = { down: false };
      const { layer, scheduled, scheduledAt } = boundaries({
        failCreateIdentity: () => ses.down,
        failSchedule: () => redisDown,
      });
      return Effect.gen(function* () {
        const projectId = yield* insertProject();
        const fqdn = `${Bun.randomUUIDv7()}.example.test`;
        redisDown = true;
        expect(
          yield* Effect.flip(createCustomDomain({ fqdn, organizationId: projectId })),
        ).toMatchObject({ operation: "schedule" });
        redisDown = false;
        // The Domain is registered, and nothing will check it.
        const domain = yield* domainOf(fqdn);
        expect(domain).toMatchObject({
          lastCheckedAt: null,
          registration: { region: "eu-central-1" },
        });
        // One with no registration has nothing to check yet.
        const unregistered = yield* unregisteredDomain(ses);
        expect(scheduled).toEqual([]);

        // The worker starts.
        const before = Date.now();
        yield* emailVerifyCustomDomainHandler.reconcile ?? Effect.die("The handler reconciles");

        const check = {
          name: "email.verify-custom-domain",
          payload: { customDomainId: domain?.id },
        };
        expect(scheduled).toContainEqual(check);
        // Due now, not at a time it never recorded.
        const dueAt = scheduledAt[scheduled.findIndex((job) => Bun.deepEquals(job, check))];
        expect(dueAt).toBeGreaterThanOrEqual(before);
        expect(dueAt).toBeLessThanOrEqual(Date.now());
        expect(scheduled).not.toContainEqual({
          name: "email.verify-custom-domain",
          payload: { customDomainId: unregistered.customDomainId },
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.live("a new Domain is the adding Project's, registered and scheduled for checks", () => {
    const { layer, scheduled } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const projectId = yield* insertProject();
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;

      const created = yield* createCustomDomain({ fqdn, organizationId: projectId });

      expect(created.kind).toBe("created");
      expect(yield* linkOf(created.customDomainId, projectId)).toMatchObject({
        ownershipVerificationStatus: "verified",
      });
      const domain = yield* db.query.customDomain.findFirst({
        where: { id: created.customDomainId },
        with: { dnsRecords: true, registration: true },
      });
      expect(domain).toMatchObject({
        provider: "cloudflare",
        registration: { region: "eu-central-1" },
      });
      expect(domain?.dnsRecords.map((record) => record.purpose)).toContain("dkim");
      expect(scheduled).toEqual([
        {
          name: "email.verify-custom-domain",
          payload: { customDomainId: created.customDomainId },
        },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.live("a first add that failed to register ends registered and scheduled on retry", () => {
    let sesDown = true;
    const { layer, scheduled } = boundaries({ failCreateIdentity: () => sesDown });
    return Effect.gen(function* () {
      const db = yield* DB;
      const projectId = yield* insertProject();
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;

      const failed = yield* Effect.flip(createCustomDomain({ fqdn, organizationId: projectId }));
      expect(failed).toMatchObject({ operation: "register_identity" });
      const left = yield* db.query.customDomain.findFirst({
        where: { fqdn },
        with: { organizations: true, registration: true },
      });
      // The Domain stays with the Project that added it, unregistered and never checked.
      expect(left).toMatchObject({
        organizations: [{ organizationId: projectId, ownershipVerificationStatus: "verified" }],
        registration: null,
      });
      expect(scheduled).toEqual([]);

      sesDown = false;
      const retried = yield* createCustomDomain({ fqdn, organizationId: projectId });

      expect(retried).toEqual({ customDomainId: left?.id, kind: "existing" });
      const domain = yield* db.query.customDomain.findFirst({
        where: { fqdn },
        with: { dnsRecords: true, registration: true },
      });
      expect(domain?.registration).toMatchObject({ region: "eu-central-1" });
      expect(domain?.dnsRecords.map((record) => record.purpose)).toContain("dkim");
      expect(scheduled).toEqual([
        { name: "email.verify-custom-domain", payload: { customDomainId: left?.id } },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.live("a Domain whose holder is gone is claimed with proof, not handed over", () => {
    const { layer, scheduled } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const holderId = yield* insertProject();
      const nextId = yield* insertProject();
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;
      const { customDomainId } = yield* createCustomDomain({ fqdn, organizationId: holderId });
      yield* db
        .update(customDomain)
        .set({ provider: "unknown", verificationStatus: "verified" })
        .where(eq(customDomain.id, customDomainId));
      // Deleting the Project takes its link and leaves the Domain.
      yield* db.delete(organization).where(eq(organization.id, holderId));
      scheduled.length = 0;

      const added = yield* createCustomDomain({ fqdn, organizationId: nextId });

      expect(added).toEqual({ customDomainId, kind: "claim" });
      expect(yield* linkOf(customDomainId, nextId)).toMatchObject({
        ownershipVerificationStatus: "not_verified",
      });
      expect(
        yield* db.query.customDomain.findFirst({
          columns: { provider: true },
          where: { id: customDomainId },
        }),
      ).toEqual({ provider: "cloudflare" });
      expect(scheduled).toContainEqual({
        name: "email.verify-ownership",
        payload: { customDomainId, organizationId: nextId },
      });
    }).pipe(Effect.provide(layer));
  });

  it.live("claims run side by side, and the first proven takes the Domain from the rest", () => {
    const { cancelled, layer, published } = boundaries();
    return Effect.gen(function* () {
      const {
        claimantIds: [firstId, secondId],
        customDomainId,
      } = yield* claimedDomain(2);
      if (!(firstId && secondId)) {
        return yield* Effect.die("Two claims were made");
      }

      // The second claim is proven while the first is still pending.
      yield* publishProof(published, customDomainId, secondId);
      expect(yield* checkOwnership(customDomainId, firstId)).toMatchObject({
        ownershipVerificationStatus: "not_verified",
      });
      expect(yield* checkOwnership(customDomainId, secondId)).toMatchObject({
        ownershipVerificationStatus: "verified",
      });

      expect(yield* linksOf(customDomainId)).toEqual([
        { organizationId: secondId, ownershipVerificationStatus: "verified" },
      ]);

      // The superseded claim's scheduled check ends its job instead of failing into retries.
      cancelled.length = 0;
      yield* emailVerifyOwnershipHandler.handle(
        { customDomainId, organizationId: firstId },
        { attempt: 1, enqueuedAt: Date.now(), id: "job_superseded" },
      );
      expect(cancelled).toEqual([
        {
          name: "email.verify-ownership",
          payload: { customDomainId, organizationId: firstId },
        },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.live("two claims proven at once end with exactly one holder", () => {
    const { layer, published } = boundaries();
    return Effect.gen(function* () {
      const { claimantIds, customDomainId } = yield* claimedDomain(2);
      for (const claimantId of claimantIds) {
        yield* publishProof(published, customDomainId, claimantId);
      }

      const results = yield* Effect.all(
        claimantIds.map((claimantId) => checkOwnership(customDomainId, claimantId)),
        { concurrency: "unbounded" },
      );

      expect(results.map((result) => result.ownershipVerificationStatus).toSorted()).toEqual([
        "superseded",
        "verified",
      ]);
      const winner = results.find((result) => result.ownershipVerificationStatus === "verified");
      expect(yield* linksOf(customDomainId)).toEqual([
        { organizationId: winner?.organizationId, ownershipVerificationStatus: "verified" },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.live("a lapsed claim's next check removes it, and a holder stays proven", () => {
    const { layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const {
        claimantIds: [claimantId],
        customDomainId,
        holderId,
      } = yield* claimedDomain(1);
      if (!claimantId) {
        return yield* Effect.die("A claim was made");
      }
      yield* db
        .update(organizationDomain)
        .set({ createdAt: new Date(Date.now() - CLAIM_TTL_MS - 60_000) })
        .where(
          and(
            eq(organizationDomain.organizationId, claimantId),
            eq(organizationDomain.customDomainId, customDomainId),
          ),
        );

      expect(yield* checkOwnership(customDomainId, claimantId)).toMatchObject({
        ownershipVerificationStatus: "lapsed",
      });
      expect(yield* linkOf(customDomainId, claimantId)).toBeUndefined();

      // The holder's own link stays proven though no TXT record is published for it.
      expect(yield* checkOwnership(customDomainId, holderId)).toMatchObject({
        ownershipVerificationStatus: "verified",
      });
      expect(yield* linksOf(customDomainId)).toEqual([
        { organizationId: holderId, ownershipVerificationStatus: "verified" },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.live("a lapsed claim proven by a refresh a moment ago is kept", () => {
    const { layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const {
        claimantIds: [claimantId],
        customDomainId,
      } = yield* claimedDomain(1);
      if (!claimantId) {
        return yield* Effect.die("A claim was made");
      }
      const lapsedAt = new Date(Date.now() - CLAIM_TTL_MS - 60_000);
      yield* db
        .update(organizationDomain)
        .set({ createdAt: lapsedAt })
        .where(
          and(
            eq(organizationDomain.organizationId, claimantId),
            eq(organizationDomain.customDomainId, customDomainId),
          ),
        );
      const pending = yield* linkOf(customDomainId, claimantId);
      // A refresh proves the claim after this check read it as pending, before it deletes.
      yield* db
        .update(organizationDomain)
        .set({ ownershipVerificationStatus: "verified" })
        .where(
          and(
            eq(organizationDomain.organizationId, claimantId),
            eq(organizationDomain.customDomainId, customDomainId),
          ),
        );
      const readBeforeTheProof = new Proxy(db, {
        get: (target, key) =>
          key === "query"
            ? { ...target.query, organizationDomain: { findFirst: () => Effect.succeed(pending) } }
            : Reflect.get(target, key),
      });
      const domain = yield* db.query.customDomain.findFirst({ where: { id: customDomainId } });
      if (!domain) {
        return yield* Effect.die("Domain is gone");
      }

      yield* verifyCustomDomainOwnership({
        customDomain: domain,
        db: readBeforeTheProof,
        organizationId: claimantId,
      });

      expect(yield* linkOf(customDomainId, claimantId)).toMatchObject({
        ownershipVerificationStatus: "verified",
      });
    }).pipe(Effect.provide(layer));
  });

  it.live("a deleted Project's Domain goes with it, and its SES identity is deleted", () => {
    const { deletedIdentities, enqueued, layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const projectId = yield* insertProject();
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;
      const { customDomainId } = yield* createCustomDomain({ fqdn, organizationId: projectId });
      const dkimSelector = yield* selectorOf(customDomainId);

      // As the api deletes a Project: its links are read, it goes, and they are followed up.
      const links = yield* linksOf(customDomainId);
      yield* db.delete(organization).where(eq(organization.id, projectId));
      yield* removeDeletedProjectDomains({
        links: links.map((link) => ({ ...link, customDomainId })),
        organizationId: projectId,
      });

      expect(yield* domainOf(fqdn)).toBeUndefined();
      // The job names the identity by the selector the Domain signed with.
      expect(enqueued).toEqual([
        {
          name: "email.delete-domain-identity",
          payload: { dkimSelector, fqdn, region: "eu-central-1" },
        },
      ]);
      yield* runIdentityDeletes(enqueued, fqdn);
      expect(deletedIdentities).toEqual([{ fqdn, region: "eu-central-1" }]);
    }).pipe(Effect.provide(layer));
  });

  it.live("a deleted Project's claims stop being checked and leave the holder's Domain", () => {
    const { cancelled, enqueued, layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const {
        claimantIds: [claimantId],
        customDomainId,
        fqdn,
        holderId,
      } = yield* claimedDomain(1);
      if (!claimantId) {
        return yield* Effect.die("A claim was made");
      }

      const links = (yield* linksOf(customDomainId)).filter(
        (link) => link.organizationId === claimantId,
      );
      yield* db.delete(organization).where(eq(organization.id, claimantId));
      yield* removeDeletedProjectDomains({
        links: links.map((link) => ({ ...link, customDomainId })),
        organizationId: claimantId,
      });

      expect(cancelled).toEqual([
        { name: "email.verify-ownership", payload: { customDomainId, organizationId: claimantId } },
      ]);
      expect(yield* domainOf(fqdn)).toMatchObject({
        id: customDomainId,
        organizations: [{ organizationId: holderId, ownershipVerificationStatus: "verified" }],
        registration: { region: "eu-central-1" },
      });
      expect(enqueued).toEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.live("removing a claim cancels its check and leaves the holder's Domain", () => {
    const { cancelled, enqueued, layer } = boundaries();
    return Effect.gen(function* () {
      const {
        claimantIds: [claimantId],
        customDomainId,
        fqdn,
        holderId,
      } = yield* claimedDomain(1);
      if (!claimantId) {
        return yield* Effect.die("A claim was made");
      }

      expect(yield* deleteCustomDomain({ customDomainId, organizationId: claimantId })).toEqual({
        deleted: false,
      });

      const claimCheck = {
        name: "email.verify-ownership",
        payload: { customDomainId, organizationId: claimantId },
      };
      expect(cancelled).toEqual([claimCheck]);
      expect(yield* domainOf(fqdn)).toMatchObject({
        id: customDomainId,
        organizations: [{ organizationId: holderId, ownershipVerificationStatus: "verified" }],
        registration: { region: "eu-central-1" },
      });
      expect(enqueued).toEqual([]);

      // A check already on its way to a worker ends without failing into dead letters.
      yield* emailVerifyOwnershipHandler.handle(claimCheck.payload, {
        attempt: 1,
        enqueuedAt: Date.now(),
        id: "job_removed_claim",
      });
    }).pipe(Effect.provide(layer));
  });

  it.live("a Project whose Domain was taken by a proven claim can no longer remove it", () => {
    const { enqueued, layer, published } = boundaries();
    return Effect.gen(function* () {
      const {
        claimantIds: [claimantId],
        customDomainId,
        fqdn,
        holderId,
      } = yield* claimedDomain(1);
      if (!claimantId) {
        return yield* Effect.die("A claim was made");
      }
      yield* publishProof(published, customDomainId, claimantId);
      yield* checkOwnership(customDomainId, claimantId);

      expect(
        yield* Effect.flip(deleteCustomDomain({ customDomainId, organizationId: holderId })),
      ).toMatchObject({ message: "Domain is not linked to this Project." });

      expect(yield* domainOf(fqdn)).toMatchObject({
        id: customDomainId,
        organizations: [{ organizationId: claimantId, ownershipVerificationStatus: "verified" }],
        registration: { region: "eu-central-1" },
      });
      expect(enqueued).toEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.live("a removed Domain is new to whoever adds it next, and keeps its new identity", () => {
    const { deletedIdentities, enqueued, identities, layer } = boundaries();
    return Effect.gen(function* () {
      const holderId = yield* insertProject();
      const nextId = yield* insertProject();
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;
      const first = yield* createCustomDomain({ fqdn, organizationId: holderId });

      expect(
        yield* deleteCustomDomain({
          customDomainId: first.customDomainId,
          organizationId: holderId,
        }),
      ).toEqual({ deleted: true });
      expect(yield* domainOf(fqdn)).toBeUndefined();

      // The FQDN is added again before the worker has deleted the old identity.
      const second = yield* createCustomDomain({ fqdn, organizationId: nextId });
      expect(second.kind).toBe("created");
      expect(second.customDomainId).not.toBe(first.customDomainId);

      // SES names the identity by FQDN and still held the removed Domain's, signing with its
      // selector. The registration deleted that one, as its job would have, and made its own.
      const selector = yield* selectorOf(second.customDomainId);
      expect(deletedIdentities).toEqual([{ fqdn, region: "eu-central-1" }]);
      expect(identities.get(fqdn)).toBe(selector);

      // The removed Domain's job then finds nothing of its own to delete.
      expect(yield* runIdentityDeletes(enqueued, fqdn)).toHaveLength(1);
      expect(deletedIdentities).toHaveLength(1);
      expect(identities.get(fqdn)).toBe(selector);
      expect(yield* domainOf(fqdn)).toMatchObject({
        id: second.customDomainId,
        organizations: [{ organizationId: nextId, ownershipVerificationStatus: "verified" }],
        registration: { region: "eu-central-1" },
      });
    }).pipe(Effect.provide(layer));
  });

  it.live("a claim that lands as the last holder leaves keeps the Domain", () => {
    const { enqueued, layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const holderId = yield* insertProject();
      const claimantId = yield* insertProject();
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;
      const { customDomainId } = yield* createCustomDomain({ fqdn, organizationId: holderId });

      // The claim's link is written but not yet committed when the holder removes the
      // Domain: the removal can't see it, and must wait for it rather than take the Domain.
      yield* Effect.all(
        [
          db.transaction((tx) =>
            tx
              .insert(organizationDomain)
              .values({
                customDomainId,
                organizationId: claimantId,
                ownershipToken: createOwnershipToken(),
              })
              .pipe(Effect.andThen(Effect.sleep("400 millis"))),
          ),
          Effect.sleep("100 millis").pipe(
            Effect.andThen(deleteCustomDomain({ customDomainId, organizationId: holderId })),
          ),
        ],
        { concurrency: "unbounded" },
      );

      expect(yield* domainOf(fqdn)).toMatchObject({
        id: customDomainId,
        organizations: [
          { organizationId: claimantId, ownershipVerificationStatus: "not_verified" },
        ],
        registration: { region: "eu-central-1" },
      });
      expect(enqueued).toEqual([]);
    }).pipe(Effect.provide(layer));
  });

  it.live("a Domain added as its last link goes ends held or claimed, and registered", () => {
    const { enqueued, identities, layer } = boundaries();
    return Effect.gen(function* () {
      const rounds = yield* Effect.forEach(
        Array.from({ length: 8 }),
        () =>
          Effect.gen(function* () {
            const holderId = yield* insertProject();
            const nextId = yield* insertProject();
            const fqdn = `${Bun.randomUUIDv7()}.example.test`;
            const { customDomainId } = yield* createCustomDomain({
              fqdn,
              organizationId: holderId,
            });
            const [, added] = yield* Effect.all(
              [
                deleteCustomDomain({ customDomainId, organizationId: holderId }),
                createCustomDomain({ fqdn, organizationId: nextId }),
              ],
              { concurrency: "unbounded" },
            );
            return { added, fqdn, nextId };
          }),
        { concurrency: 4 },
      );

      for (const { added, fqdn, nextId } of rounds) {
        // Whichever came first, the adding Project's link is to a Domain that exists and is
        // registered: a claim on the one that stayed, or a new one in its place.
        expect(yield* domainOf(fqdn)).toMatchObject({
          id: added.customDomainId,
          organizations: [
            {
              organizationId: nextId,
              ownershipVerificationStatus: added.kind === "claim" ? "not_verified" : "verified",
            },
          ],
          registration: { region: "eu-central-1" },
        });
        // And SES holds that Domain's identity, whatever the removed one's job found.
        yield* runIdentityDeletes(enqueued, fqdn);
        expect(identities.get(fqdn)).toBe(yield* selectorOf(added.customDomainId));
      }
    }).pipe(Effect.provide(layer));
  });

  it.live("a lapsed claim that was a Domain's last link takes the Domain with it", () => {
    const { deletedIdentities, enqueued, layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const {
        claimantIds: [claimantId],
        customDomainId,
        fqdn,
        holderId,
      } = yield* claimedDomain(1);
      if (!claimantId) {
        return yield* Effect.die("A claim was made");
      }
      // The holder's Project was deleted before Domains followed their last link.
      yield* db.delete(organization).where(eq(organization.id, holderId));
      yield* db
        .update(organizationDomain)
        .set({ createdAt: new Date(Date.now() - CLAIM_TTL_MS - 60_000) })
        .where(eq(organizationDomain.customDomainId, customDomainId));

      expect(yield* checkOwnership(customDomainId, claimantId)).toMatchObject({
        ownershipVerificationStatus: "lapsed",
      });

      expect(yield* domainOf(fqdn)).toBeUndefined();
      yield* runIdentityDeletes(enqueued, fqdn);
      expect(deletedIdentities).toEqual([{ fqdn, region: "eu-central-1" }]);
    }).pipe(Effect.provide(layer));
  });

  it.live("a removed Domain that sent mail leaves no row, and is new when added again", () => {
    const { deletedIdentities, enqueued, layer, scheduled } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const projectId = yield* insertProject();
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;
      const { customDomainId } = yield* createCustomDomain({ fqdn, organizationId: projectId });
      const key = yield* dkimKeyOf(customDomainId);
      const sent = yield* sentFrom({ customDomainId, fqdn, organizationId: projectId });
      const before = yield* historyOf(projectId);
      expect(before).toMatchObject([
        { delivery: { customDomainId, id: sent.id }, event: { customDomainId } },
      ]);

      expect(yield* deleteCustomDomain({ customDomainId, organizationId: projectId })).toEqual({
        deleted: true,
      });

      expect(yield* domainOf(fqdn)).toBeUndefined();
      expect(
        yield* db.select().from(customDomain).where(eq(customDomain.id, customDomainId)),
      ).toEqual([]);
      yield* runIdentityDeletes(enqueued, fqdn);
      expect(deletedIdentities).toEqual([{ fqdn, region: "eu-central-1" }]);

      // The Project's history reads as it did, with its From, less the reference to the
      // Domain: the Delivery names the FQDN it was sent from and its event names nothing.
      const [past] = before;
      if (!past?.event) {
        return yield* Effect.die("The Delivery and its event were read");
      }
      const removed = [
        {
          delivery: { ...past.delivery, customDomainId: null, removedDomainFqdn: fqdn },
          event: { ...past.event, customDomainId: null },
          message: past.message,
        },
      ];
      expect(yield* historyOf(projectId)).toEqual(removed);
      expect(removed[0]?.delivery.from).toEqual({
        address: `hello@${fqdn}`,
        normalized: `hello@${fqdn}`,
      });

      scheduled.length = 0;
      const again = yield* createCustomDomain({ fqdn, organizationId: projectId });
      expect(again).toMatchObject({ kind: "created" });
      expect(again.customDomainId).not.toBe(customDomainId);
      const newKey = yield* dkimKeyOf(again.customDomainId);
      expect(newKey.dkimPublicKey).not.toBe(key.dkimPublicKey);
      expect(newKey.dkimPrivateKey).not.toBe(key.dkimPrivateKey);
      // New, so held at once: no claim to prove.
      expect(yield* domainOf(fqdn)).toMatchObject({
        organizations: [{ organizationId: projectId, ownershipVerificationStatus: "verified" }],
        registration: { region: "eu-central-1" },
      });
      expect(scheduled).toEqual([
        { name: "email.verify-custom-domain", payload: { customDomainId: again.customDomainId } },
      ]);
      // The old Deliveries are not picked up by the Domain that now has their FQDN.
      expect(yield* historyOf(projectId)).toEqual(removed);
    }).pipe(Effect.provide(layer));
  });

  it.live("a Domain added by another Project after its removal has none of its history", () => {
    const { layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const firstId = yield* insertProject();
      const nextId = yield* insertProject();
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;
      const first = yield* createCustomDomain({ fqdn, organizationId: firstId });
      const firstKey = yield* dkimKeyOf(first.customDomainId);
      yield* sentFrom({ customDomainId: first.customDomainId, fqdn, organizationId: firstId });
      yield* sentFrom({ customDomainId: first.customDomainId, fqdn, organizationId: firstId });
      yield* deleteCustomDomain({ customDomainId: first.customDomainId, organizationId: firstId });
      const firstHistory = yield* historyOf(firstId);
      expect(firstHistory).toHaveLength(2);

      const next = yield* createCustomDomain({ fqdn, organizationId: nextId });

      // A new Domain, held without a claim, under its own key.
      expect(next).toMatchObject({ kind: "created" });
      expect(next.customDomainId).not.toBe(first.customDomainId);
      expect((yield* dkimKeyOf(next.customDomainId)).dkimPublicKey).not.toBe(
        firstKey.dkimPublicKey,
      );
      expect(yield* linksOf(next.customDomainId)).toEqual([
        { organizationId: nextId, ownershipVerificationStatus: "verified" },
      ]);
      // Nothing the first Project sent is the new Domain's or the next Project's.
      const namingNext = Effect.gen(function* () {
        return {
          deliveries: yield* db
            .select({ id: emailDelivery.id })
            .from(emailDelivery)
            .where(eq(emailDelivery.customDomainId, next.customDomainId)),
          events: yield* db
            .select({ id: emailDeliveryEvent.id })
            .from(emailDeliveryEvent)
            .where(eq(emailDeliveryEvent.customDomainId, next.customDomainId)),
        };
      });
      expect(yield* namingNext).toEqual({ deliveries: [], events: [] });
      expect(yield* historyOf(nextId)).toEqual([]);
      expect(yield* historyOf(firstId)).toEqual(firstHistory);

      // What the next Project sends, and its removing the Domain, leave the first
      // Project's history alone, though both now record the same FQDN.
      const sent = yield* sentFrom({
        customDomainId: next.customDomainId,
        fqdn,
        organizationId: nextId,
      });
      expect(yield* namingNext).toMatchObject({ deliveries: [{ id: sent.id }], events: [{}] });
      yield* deleteCustomDomain({ customDomainId: next.customDomainId, organizationId: nextId });
      expect(yield* historyOf(firstId)).toEqual(firstHistory);
      expect(yield* historyOf(nextId)).toMatchObject([
        { delivery: { customDomainId: null, id: sent.id, removedDomainFqdn: fqdn } },
      ]);
    }).pipe(Effect.provide(layer));
  });

  /** What names a Domain's row: Deliveries, their events, and whether it is paused. */
  const namingDomain = Effect.fn(function* (customDomainId: string) {
    const db = yield* DB;
    return {
      deliveries: yield* db
        .select({ id: emailDelivery.id })
        .from(emailDelivery)
        .where(eq(emailDelivery.customDomainId, customDomainId)),
      events: yield* db
        .select({ id: emailDeliveryEvent.id })
        .from(emailDeliveryEvent)
        .where(eq(emailDeliveryEvent.customDomainId, customDomainId)),
      paused: (yield* db.query.customDomain.findFirst({
        columns: { isPaused: true },
        where: { id: customDomainId },
      }))?.isPaused,
    };
  });

  // The row outlives the sender's link when another Project takes the Domain by a claim:
  // with the holder removing it while the claim is pending, and with the holder doing nothing.
  it.live.each([true, false])(
    "a Domain taken by a claim has none of its old holder's history (holder removed it first: %s)",
    (holderRemoves) => {
      const { layer, published } = boundaries();
      return Effect.gen(function* () {
        const db = yield* DB;
        const {
          claimantIds: [claimantId],
          customDomainId,
          fqdn,
          holderId,
        } = yield* claimedDomain(1);
        if (!claimantId) {
          return yield* Effect.die("A claim was made");
        }
        const key = yield* dkimKeyOf(customDomainId);
        yield* db.insert(webhookEndpoint).values(
          [holderId, claimantId].map((organizationId) => ({
            eventTypes: ["delivery.bounced"],
            organizationId,
            signingSecret: "secret",
            url: "https://hooks.example.com/relayit",
          })),
        );
        const webhooksOf = (organizationId: string) =>
          db
            .select({ type: webhookEvent.type })
            .from(webhookEvent)
            .where(eq(webhookEvent.organizationId, organizationId));
        const sent = yield* sentFrom({ customDomainId, fqdn, organizationId: holderId });
        const [before] = yield* historyOf(holderId);
        if (!before?.event || !sent.providerMessageId) {
          return yield* Effect.die("The Delivery and its event were read");
        }
        yield* db.insert(contact).values({
          email: "to@example.com",
          organizationAppEnvironmentId: before.message.organizationAppEnvironmentId,
        });
        const detached = {
          delivery: { ...before.delivery, customDomainId: null, removedDomainFqdn: fqdn },
          event: { ...before.event, customDomainId: null },
          message: before.message,
        };

        if (holderRemoves) {
          // The row stays for the claim, and already nothing the holder sent names it.
          expect(yield* deleteCustomDomain({ customDomainId, organizationId: holderId })).toEqual({
            deleted: false,
          });
          expect(yield* namingDomain(customDomainId)).toEqual({
            deliveries: [],
            events: [],
            paused: false,
          });
          expect(yield* historyOf(holderId)).toEqual([detached]);
        }
        yield* publishProof(published, customDomainId, claimantId);
        expect(yield* checkOwnership(customDomainId, claimantId)).toMatchObject({
          ownershipVerificationStatus: "verified",
        });

        // The claimant holds the same row under the same key, with none of that history.
        expect(yield* linksOf(customDomainId)).toEqual([
          { organizationId: claimantId, ownershipVerificationStatus: "verified" },
        ]);
        expect(yield* dkimKeyOf(customDomainId)).toEqual(key);
        expect(yield* namingDomain(customDomainId)).toEqual({
          deliveries: [],
          events: [],
          paused: false,
        });
        expect(yield* historyOf(holderId)).toEqual([detached]);
        expect(yield* historyOf(claimantId)).toEqual([]);

        // A bounce for the old send is the old holder's: recorded on its Delivery, heard by
        // it, suppressing in its App Environment, and nothing to the Domain or its holder.
        yield* ingestDeliveryEvents(db, {
          events: [
            {
              kind: "bounced",
              notificationId: Bun.randomUUIDv7(),
              providerMessageId: sent.providerMessageId,
              raw: { bounce: { bounceType: "Permanent" } },
              recipients: ["to@example.com"],
              sentAt: new Date(),
              suppress: true,
            },
          ],
        });
        expect(
          (yield* historyOf(holderId))
            .map(({ delivery, event }) => ({
              customDomainId: event?.customDomainId,
              deliveryId: delivery.id,
              kind: event?.kind,
            }))
            .toSorted((left, right) => (left.kind ?? "").localeCompare(right.kind ?? "")),
        ).toEqual([
          { customDomainId: null, deliveryId: sent.id, kind: "bounced" },
          { customDomainId: null, deliveryId: sent.id, kind: "delivered" },
        ]);
        expect(
          yield* db
            .select({ reason: contact.suppressionReason })
            .from(contact)
            .where(
              eq(contact.organizationAppEnvironmentId, before.message.organizationAppEnvironmentId),
            ),
        ).toEqual([{ reason: "hard_bounce" }]);
        expect(yield* webhooksOf(holderId)).toEqual([{ type: "delivery.bounced" }]);
        expect(yield* webhooksOf(claimantId)).toEqual([]);
        expect(yield* namingDomain(customDomainId)).toEqual({
          deliveries: [],
          events: [],
          paused: false,
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.live(
    "a claimant's removed or lapsed claim leaves the holder's Deliveries on the Domain",
    () => {
      const { layer } = boundaries();
      return Effect.gen(function* () {
        const {
          claimantIds: [removingId, lapsingId],
          customDomainId,
          fqdn,
          holderId,
        } = yield* claimedDomain(2);
        if (!(removingId && lapsingId)) {
          return yield* Effect.die("Two claims were made");
        }
        const db = yield* DB;
        const sent = yield* sentFrom({ customDomainId, fqdn, organizationId: holderId });
        const history = yield* historyOf(holderId);

        yield* deleteCustomDomain({ customDomainId, organizationId: removingId });
        yield* db
          .update(organizationDomain)
          .set({ createdAt: new Date(Date.now() - CLAIM_TTL_MS - 60_000) })
          .where(
            and(
              eq(organizationDomain.customDomainId, customDomainId),
              eq(organizationDomain.organizationId, lapsingId),
            ),
          );
        expect(yield* checkOwnership(customDomainId, lapsingId)).toMatchObject({
          ownershipVerificationStatus: "lapsed",
        });

        // Only a leaving Project's own Deliveries move.
        expect(yield* historyOf(holderId)).toEqual(history);
        expect(yield* namingDomain(customDomainId)).toMatchObject({
          deliveries: [{ id: sent.id }],
          events: [{}],
        });
      }).pipe(Effect.provide(layer));
    },
  );

  it.live("a deleted Project's Deliveries go with it, off a Domain another Project claims", () => {
    const { layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const { customDomainId, fqdn, holderId } = yield* claimedDomain(1);
      yield* sentFrom({ customDomainId, fqdn, organizationId: holderId });

      // The Project's Messages, Deliveries and events are deleted with it by the database.
      yield* db.delete(organization).where(eq(organization.id, holderId));

      expect(yield* namingDomain(customDomainId)).toEqual({
        deliveries: [],
        events: [],
        paused: false,
      });
    }).pipe(Effect.provide(layer));
  });

  it.live(
    "a Project with more Deliveries on a Domain than one query can name is detached whole",
    () => {
      const { layer } = boundaries();
      return Effect.gen(function* () {
        const db = yield* DB;
        const { customDomainId, fqdn, holderId } = yield* claimedDomain(1);
        const first = yield* sentFrom({ customDomainId, fqdn, organizationId: holderId });
        // Past the 65,535 parameters Postgres takes in one query, each with an event.
        const more = 70_000;
        const prefix = Bun.randomUUIDv7().replaceAll("-", "");
        yield* db.execute(sql`
          with numbered as (select g from generate_series(1, ${more}) g),
          messages as (
            insert into message (id, organization_app_environment_id, purpose)
            select 'msg_' || ${prefix} || g, (select organization_app_environment_id from message where id = ${first.messageId}), 'transactional'
            from numbered
          ),
          deliveries as (
            insert into email_delivery (id, message_id, custom_domain_id, status, "from", "to", subject, text)
            select 'edlv_' || ${prefix} || g, 'msg_' || ${prefix} || g, ${customDomainId}, 'sent',
              ${JSON.stringify({ address: `hello@${fqdn}`, normalized: `hello@${fqdn}` })}::jsonb,
              '["to@example.com"]'::jsonb, 'Hi', 'Hi'
            from numbered
          )
          insert into email_delivery_event (id, email_delivery_id, custom_domain_id, kind)
          select 'edev_' || ${prefix} || g, 'edlv_' || ${prefix} || g, ${customDomainId}, 'delivered'
          from numbered`);
        // A deployment's tables have statistics; rows loaded a moment ago do not, and
        // without them the planner joins these the slow way round.
        yield* db.execute(sql`analyze message, email_delivery, email_delivery_event`);
        const counts = Effect.gen(function* () {
          const [deliveries] = yield* db
            .select({ naming: count(emailDelivery.customDomainId), total: count() })
            .from(emailDelivery)
            .where(
              or(
                eq(emailDelivery.customDomainId, customDomainId),
                eq(emailDelivery.removedDomainFqdn, fqdn),
              ),
            );
          const [events] = yield* db
            .select({ naming: count() })
            .from(emailDeliveryEvent)
            .where(eq(emailDeliveryEvent.customDomainId, customDomainId));
          return { deliveries, events };
        });
        expect(yield* counts).toEqual({
          deliveries: { naming: more + 1, total: more + 1 },
          events: { naming: more + 1 },
        });

        // The row stays for the claim on it.
        expect(yield* deleteCustomDomain({ customDomainId, organizationId: holderId })).toEqual({
          deleted: false,
        });

        expect(yield* counts).toEqual({
          deliveries: { naming: 0, total: more + 1 },
          events: { naming: 0 },
        });
      }).pipe(Effect.provide(layer));
    },
    120_000,
  );

  it.live("a Delivery can't be written, or left, naming no Domain at all", () => {
    const { layer } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const projectId = yield* insertProject();
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;
      const { customDomainId } = yield* createCustomDomain({ fqdn, organizationId: projectId });
      const sent = yield* sentFrom({ customDomainId, fqdn, organizationId: projectId });
      const { id: _id, createdAt: _createdAt, ...values } = sent;
      const refusedBy = (constraint: string) => ({
        cause: { reasons: [{ error: { reason: { cause: { constraint } } } }] },
      });

      // Neither a new Delivery with no sender, nor one that loses its Domain any other way
      // than the removal, which records the FQDN as it clears the reference.
      expect(
        yield* Effect.flip(db.insert(emailDelivery).values({ ...values, customDomainId: null })),
      ).toMatchObject(refusedBy("email_delivery_sender_kind_check"));
      expect(
        yield* Effect.flip(
          db
            .update(emailDelivery)
            .set({ customDomainId: null })
            .where(eq(emailDelivery.id, sent.id)),
        ),
      ).toMatchObject(refusedBy("email_delivery_sender_kind_check"));
      expect(
        yield* Effect.flip(db.delete(customDomain).where(eq(customDomain.id, customDomainId))),
      ).toMatchObject(refusedBy("email_delivery_custom_domain_id_custom_domain_id_fkey"));
    }).pipe(Effect.provide(layer));
  });

  it.live("a Domain removed before its registration is finished gets no identity", () => {
    const ses = { down: false };
    let remove: Effect.Effect<void> = Effect.void;
    const { createdIdentities, layer } = boundaries({
      beforeKeyLoad: () => remove,
      failCreateIdentity: () => ses.down,
    });
    return Effect.gen(function* () {
      const services = yield* Effect.context<DB | Jobs>();
      const { customDomainId, fqdn, holderId } = yield* unregisteredDomain(ses);

      // The holder adds it again to finish the registration, and removes it before the add
      // reaches SES.
      remove = Effect.suspend(() => {
        remove = Effect.void;
        return deleteCustomDomain({ customDomainId, organizationId: holderId });
      }).pipe(Effect.provide(services), Effect.orDie);
      expect(
        yield* Effect.flip(createCustomDomain({ fqdn, organizationId: holderId })),
      ).toMatchObject({
        message: "Domain was removed before it was registered with SES.",
        operation: "register_identity",
      });

      expect(createdIdentities).toEqual([]);
      expect(yield* domainOf(fqdn)).toBeUndefined();
    }).pipe(Effect.provide(layer));
  });

  it.live("a claim whose registration failed is checked, and adding it again registers it", () => {
    const ses = { down: false };
    const { layer, scheduled } = boundaries({ failCreateIdentity: () => ses.down });
    return Effect.gen(function* () {
      const { customDomainId, fqdn, holderId } = yield* unregisteredDomain(ses);
      const claimantId = yield* insertProject();
      const claimCheck = {
        name: "email.verify-ownership",
        payload: { customDomainId, organizationId: claimantId },
      };
      const links = expect.arrayContaining([
        { organizationId: holderId, ownershipVerificationStatus: "verified" },
        { organizationId: claimantId, ownershipVerificationStatus: "not_verified" },
      ]);
      scheduled.length = 0;

      ses.down = true;
      expect(
        yield* Effect.flip(createCustomDomain({ fqdn, organizationId: claimantId })),
      ).toMatchObject({ operation: "register_identity" });
      // The claim stands unregistered, with the check that will prove or lapse it.
      expect(yield* domainOf(fqdn)).toMatchObject({ organizations: links, registration: null });
      expect(scheduled).toEqual([claimCheck]);

      ses.down = false;
      scheduled.length = 0;
      expect(yield* createCustomDomain({ fqdn, organizationId: claimantId })).toEqual({
        customDomainId,
        kind: "existing",
      });

      const registered = yield* domainOf(fqdn);
      expect(registered).toMatchObject({
        organizations: links,
        registration: { region: "eu-central-1" },
      });
      expect(registered?.dnsRecords.map((record) => record.purpose)).toContain("dkim");
      expect(scheduled).toEqual([
        claimCheck,
        { name: "email.verify-custom-domain", payload: { customDomainId } },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.live("a claimant adding a registered Domain never checked schedules its checks", () => {
    const { layer, scheduled } = boundaries();
    return Effect.gen(function* () {
      const {
        claimantIds: [claimantId],
        customDomainId,
        fqdn,
      } = yield* claimedDomain(1);
      if (!claimantId) {
        return yield* Effect.die("A claim was made");
      }
      // Registered, and the verification scheduled with the claim was lost before it ran.
      expect(yield* domainOf(fqdn)).toMatchObject({
        lastCheckedAt: null,
        registration: { region: "eu-central-1" },
      });
      scheduled.length = 0;

      expect(yield* createCustomDomain({ fqdn, organizationId: claimantId })).toEqual({
        customDomainId,
        kind: "existing",
      });

      expect(scheduled).toEqual([
        { name: "email.verify-ownership", payload: { customDomainId, organizationId: claimantId } },
        { name: "email.verify-custom-domain", payload: { customDomainId } },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.live("two claims made at once on an unregistered Domain both stand, checked", () => {
    const ses = { down: false };
    let untilBothClaimed: Effect.Effect<void> = Effect.void;
    const { createdIdentities, layer, scheduled } = boundaries({
      beforeCreateIdentity: () => untilBothClaimed,
      failCreateIdentity: () => ses.down,
    });
    return Effect.gen(function* () {
      const db = yield* DB;
      const services = yield* Effect.context<DB>();
      const { customDomainId, fqdn } = yield* unregisteredDomain(ses);
      const claimantIds = [yield* insertProject(), yield* insertProject()];
      scheduled.length = 0;
      createdIdentities.length = 0;

      // The first registration to reach SES stays there until the other claim's link has
      // committed. That claim found the Domain unregistered too, so it goes on to register
      // it and waits behind this one: the two always meet at the registration's check.
      untilBothClaimed = linksOf(customDomainId).pipe(
        Effect.filterOrFail((links) => links.length === 3),
        Effect.retry({ schedule: Schedule.spaced("20 millis"), times: 500 }),
        Effect.provide(services),
        Effect.orDie,
        Effect.asVoid,
      );
      const claims = yield* Effect.forEach(
        claimantIds,
        (organizationId) => createCustomDomain({ fqdn, organizationId }),
        { concurrency: "unbounded" },
      );

      expect(claims).toEqual([
        { customDomainId, kind: "claim" },
        { customDomainId, kind: "claim" },
      ]);
      expect(
        (yield* linksOf(customDomainId))
          .filter((link) => link.ownershipVerificationStatus === "not_verified")
          .map((link) => link.organizationId)
          .toSorted(),
      ).toEqual(claimantIds.toSorted());
      // Registered once, by whichever claim took the identity lock first.
      expect(
        yield* db.query.emailDomainRegistration.findMany({
          columns: { region: true },
          where: { customDomainId },
        }),
      ).toEqual([{ region: "eu-central-1" }]);
      expect(createdIdentities).toEqual([fqdn]);
      for (const organizationId of claimantIds) {
        expect(scheduled).toContainEqual({
          name: "email.verify-ownership",
          payload: { customDomainId, organizationId },
        });
      }
    }).pipe(Effect.provide(layer));
  });

  it.live("a claim whose check could not be scheduled is still checked, and lapses", () => {
    let redisDown = false;
    const { layer, scheduled } = boundaries({ failSchedule: () => redisDown });
    return Effect.gen(function* () {
      const db = yield* DB;
      const holderId = yield* insertProject();
      const claimantId = yield* insertProject();
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;
      const { customDomainId } = yield* createCustomDomain({ fqdn, organizationId: holderId });
      const claim = { customDomainId, organizationId: claimantId };
      scheduled.length = 0;

      redisDown = true;
      expect(
        yield* Effect.flip(createCustomDomain({ fqdn, organizationId: claimantId })),
      ).toMatchObject({ operation: "schedule" });
      redisDown = false;
      // The claim's link is written and nothing will check it.
      expect(yield* linkOf(customDomainId, claimantId)).toMatchObject({
        ownershipVerificationStatus: "not_verified",
      });
      expect(scheduled).toEqual([]);

      // The worker starts.
      yield* emailVerifyOwnershipHandler.reconcile ?? Effect.die("The handler reconciles");

      expect(scheduled).toContainEqual({ name: "email.verify-ownership", payload: claim });

      // Unproven at its TTL, the check it was given removes it and leaves the holder's.
      yield* db
        .update(organizationDomain)
        .set({ createdAt: new Date(Date.now() - CLAIM_TTL_MS - 60_000) })
        .where(
          and(
            eq(organizationDomain.customDomainId, customDomainId),
            eq(organizationDomain.organizationId, claimantId),
          ),
        );
      yield* emailVerifyOwnershipHandler.handle(claim, {
        attempt: 1,
        enqueuedAt: Date.now(),
        id: "job_verify_ownership",
      });

      expect(yield* linksOf(customDomainId)).toEqual([
        { organizationId: holderId, ownershipVerificationStatus: "verified" },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.live("a removal stands when its ownership check can't be cancelled", () => {
    const { enqueued, layer } = boundaries({ failCancel: true });
    return Effect.gen(function* () {
      const db = yield* DB;
      const holderId = yield* insertProject();
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;
      const first = yield* createCustomDomain({ fqdn, organizationId: holderId });
      expect(
        yield* deleteCustomDomain({
          customDomainId: first.customDomainId,
          organizationId: holderId,
        }),
      ).toEqual({ deleted: true });
      expect(yield* domainOf(fqdn)).toBeUndefined();

      // A deleted Project's claim was the last link to a Domain whose holder had gone.
      const claimantId = yield* insertProject();
      const orphan = `${Bun.randomUUIDv7()}.example.test`;
      const { customDomainId } = yield* createCustomDomain({
        fqdn: orphan,
        organizationId: holderId,
      });
      yield* createCustomDomain({ fqdn: orphan, organizationId: claimantId });
      yield* db.delete(organization).where(eq(organization.id, holderId));
      const links = yield* linksOf(customDomainId);
      yield* db.delete(organization).where(eq(organization.id, claimantId));
      yield* removeDeletedProjectDomains({
        links: links.map((link) => ({ ...link, customDomainId })),
        organizationId: claimantId,
      });

      expect(yield* domainOf(orphan)).toBeUndefined();
      expect(enqueued.map((job) => job.payload)).toMatchObject([
        { fqdn, region: "eu-central-1" },
        { fqdn: orphan, region: "eu-central-1" },
      ]);
    }).pipe(Effect.provide(layer));
  });

  /**
   * A database of its own, created, migrated and dropped around `use`: for what reads every
   * Domain or every Delivery, which in the shared one would take what other tests are using.
   */
  const ownDatabase = () => {
    const name = `own_${Bun.randomUUIDv7().replaceAll("-", "")}`;
    const url = new URL(testDatabaseUrl);
    url.pathname = `/${name}`;
    const admin = (statement: string) =>
      Effect.promise(async () => {
        const sql = new Bun.SQL(testDatabaseUrl);
        try {
          await sql.unsafe(statement);
        } finally {
          await sql.close();
        }
      });
    return {
      url: url.href,
      // Migrated inside, so a migration that fails still has the database dropped. The
      // layer's pool is closed before it is.
      within: <A, E>(use: Effect.Effect<A, E>) =>
        Effect.acquireUseRelease(
          admin(`create database "${name}"`),
          () => Effect.promise(() => migrateDatabase(url.href)).pipe(Effect.andThen(use)),
          () => admin(`drop database "${name}" with (force)`),
        ),
    };
  };

  it.live(
    "the sweep of every Domain removes those without a link, and only those",
    () => {
      const database = ownDatabase();
      let refused: string | undefined;
      const { deletedIdentities, enqueued, layer } = boundaries({
        databaseUrl: database.url,
        failEnqueueFor: () => refused,
      });

      const sweeps = Effect.gen(function* () {
        const db = yield* DB;
        const add = Effect.fn(function* () {
          const organizationId = yield* insertProject();
          const fqdn = `${Bun.randomUUIDv7()}.example.test`;
          const { customDomainId } = yield* createCustomDomain({ fqdn, organizationId });
          return { customDomainId, fqdn, organizationId };
        });
        const deleteProject = (organizationId: string) =>
          db.delete(organization).where(eq(organization.id, organizationId));
        // Their Deliveries outlive the Projects that held the Domains they were sent from.
        const senderIds = [yield* insertProject(), yield* insertProject()] as const;
        const deliveriesOf = (organizationId: string) =>
          historyOf(organizationId).pipe(
            Effect.map((history) =>
              history.map(({ delivery }) => ({
                customDomainId: delivery.customDomainId,
                removedDomainFqdn: delivery.removedDomainFqdn,
              })),
            ),
          );

        const linked = yield* add();
        const unlinked = yield* add();
        yield* deleteProject(unlinked.organizationId);
        // As a removal left it before a Domain's row went with its last link: unlinked and
        // unregistered, kept for the Deliveries that name it.
        const bare = yield* add();
        yield* sentFrom({ ...bare, organizationId: senderIds[0] });
        yield* deleteProject(bare.organizationId);
        yield* db
          .delete(emailDomainRegistration)
          .where(eq(emailDomainRegistration.customDomainId, bare.customDomainId));
        const sent = yield* add();
        yield* sentFrom({ ...sent, organizationId: senderIds[1] });
        yield* deleteProject(sent.organizationId);
        const failing = yield* add();
        yield* deleteProject(failing.organizationId);
        refused = failing.fqdn;
        enqueued.length = 0;

        const after = Effect.gen(function* () {
          return {
            bare: yield* domainOf(bare.fqdn),
            failing: yield* domainOf(failing.fqdn),
            linked: yield* domainOf(linked.fqdn),
            sent: yield* domainOf(sent.fqdn),
            unlinked: yield* domainOf(unlinked.fqdn),
          };
        });

        yield* removeUnlinkedDomains();

        const swept = yield* after;
        expect(swept.linked).toMatchObject({
          organizations: [{ organizationId: linked.organizationId }],
          registration: { region: "eu-central-1" },
        });
        expect(swept.unlinked).toBeUndefined();
        // Those that sent go too, and their Deliveries stay with the Projects that sent them.
        expect(swept.bare).toBeUndefined();
        expect(swept.sent).toBeUndefined();
        expect(yield* deliveriesOf(senderIds[0])).toEqual([
          { customDomainId: null, removedDomainFqdn: bare.fqdn },
        ]);
        expect(yield* deliveriesOf(senderIds[1])).toEqual([
          { customDomainId: null, removedDomainFqdn: sent.fqdn },
        ]);
        // The one whose removal failed is as it was, and did not stop the others.
        expect(swept.failing).toMatchObject({
          id: failing.customDomainId,
          registration: { region: "eu-central-1" },
        });
        expect(
          enqueued.map((job) => (job.payload as { readonly fqdn: string }).fqdn).toSorted(),
        ).toEqual([unlinked.fqdn, bare.fqdn, sent.fqdn].toSorted());

        yield* removeUnlinkedDomains();

        expect(yield* after).toEqual(swept);
        expect(enqueued).toHaveLength(3);
        expect(deletedIdentities).toEqual([]);
      });

      return database.within(sweeps.pipe(Effect.provide(layer)));
    },
    30_000,
  );
});
