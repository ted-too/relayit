/**
 * Adding and removing a Domain against a real Postgres: who ends up holding it, whether it
 * ends up registered and checked, and that it goes with its last link and takes its SES
 * identity along. SES, public DNS and the job queue are the boundaries stubbed.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { JobEnqueueError, Jobs, type JobsService } from "@repo/jobs";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import { migrateOnStartup } from "@repo/persistence/db/migrate";
import {
  customDomain,
  emailDelivery,
  message,
  organization,
  organizationAppEnvironment,
  organizationDomain,
} from "@repo/persistence/db/schema";
import { and, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { typeid } from "typeid-js";
import { EmailBackend, EmailBackendUnavailable } from "../backend";
import { DnsLookups } from "../dns-lookups";
import { EmailManagedDns } from "../managed-dns";
import { createOwnershipToken, ownershipChallengeValue } from "./dns";
import { emailDeleteDomainIdentityHandler } from "./handlers";
import type { EmailDeleteDomainIdentityPayload } from "./jobs";
import { verifyCustomDomainOwnership } from "../verification/custom-identity";
import { emailVerifyOwnershipHandler } from "../verification/handlers";
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
   * enqueued, by job, the SES identities created and deleted, and the TXT values published
   * in DNS. `beforeKeyLoad` runs as a Domain's DKIM key is read, which an add does between
   * writing a claim and registering the Domain.
   */
  const boundaries = (
    options: {
      readonly beforeKeyLoad?: () => Effect.Effect<void>;
      readonly databaseUrl?: string;
      readonly failCancel?: boolean;
      readonly failCreateIdentity?: () => boolean;
      readonly failEnqueueFor?: () => string | undefined;
    } = {},
  ) => {
    const scheduled: { readonly name: string; readonly payload: unknown }[] = [];
    const published = new Set<string>();
    const cancelled: { readonly name: string; readonly payload: unknown }[] = [];
    const enqueued: { readonly name: string; readonly payload: unknown }[] = [];
    const deletedIdentities: { readonly fqdn: string; readonly region: string | null }[] = [];
    const createdIdentities: string[] = [];
    const layer = Layer.mergeAll(
      Layer.succeed(EmailBackend, {
        createIdentity: ({ fqdn, region }) =>
          options.failCreateIdentity?.()
            ? Effect.fail(
                new EmailBackendUnavailable({
                  cause: "SES is down",
                  region: region ?? "eu-central-1",
                }),
              )
            : Effect.sync(() => {
                createdIdentities.push(fqdn);
                return { mailFrom: { domain: `send.${fqdn}`, records: [] } };
              }),
        defaultRegion: "eu-central-1",
        deleteIdentity: ({ fqdn, region }) =>
          Effect.sync(() => {
            deletedIdentities.push({ fqdn, region });
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
        schedule: ((contract: { readonly name: string }, payload: unknown) => {
          scheduled.push({ name: contract.name, payload });
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
      layer,
      published,
      scheduled,
    };
  };

  const insertProject = Effect.fn(function* () {
    const db = yield* DB;
    const id = typeid("orgn").toString();
    yield* db.insert(organization).values({ id, name: "Domains", slug: `domains-${id}` });
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

  /** A Delivery a Project sent from a Domain, which keeps naming it. */
  const sentFrom = Effect.fn(function* (input: {
    readonly customDomainId: string;
    readonly fqdn: string;
    readonly organizationId: string;
  }) {
    const db = yield* DB;
    const environmentId = typeid("oenv").toString();
    const messageId = typeid("msg").toString();
    yield* db
      .insert(organizationAppEnvironment)
      .values({ id: environmentId, organizationId: input.organizationId });
    yield* db.insert(message).values({
      id: messageId,
      organizationAppEnvironmentId: environmentId,
      purpose: "transactional",
    });
    yield* db.insert(emailDelivery).values({
      customDomainId: input.customDomainId,
      from: { address: `hello@${input.fqdn}`, normalized: `hello@${input.fqdn}` },
      messageId,
      status: "sent",
      subject: "Hi",
      text: "Hi",
      to: ["to@example.com"],
    });
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

      // As the api deletes a Project: its links are read, it goes, and they are followed up.
      const links = yield* linksOf(customDomainId);
      yield* db.delete(organization).where(eq(organization.id, projectId));
      yield* removeDeletedProjectDomains({
        links: links.map((link) => ({ ...link, customDomainId })),
        organizationId: projectId,
      });

      expect(yield* domainOf(fqdn)).toBeUndefined();
      expect(enqueued).toEqual([
        { name: "email.delete-domain-identity", payload: { fqdn, region: "eu-central-1" } },
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
    const { deletedIdentities, enqueued, layer } = boundaries();
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

      // SES names the identity by FQDN: the delete leaves it to the Domain that has it now.
      expect(yield* runIdentityDeletes(enqueued, fqdn)).toHaveLength(1);
      expect(deletedIdentities).toEqual([]);
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
    const { deletedIdentities, enqueued, layer } = boundaries();
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
        yield* runIdentityDeletes(enqueued, fqdn);
      }
      expect(deletedIdentities).toEqual([]);
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

  it.live(
    "a removed Domain its Deliveries still name is kept bare, and re-adding it is a claim",
    () => {
      const { deletedIdentities, enqueued, layer, scheduled } = boundaries();
      return Effect.gen(function* () {
        const db = yield* DB;
        const projectId = yield* insertProject();
        const fqdn = `${Bun.randomUUIDv7()}.example.test`;
        const { customDomainId } = yield* createCustomDomain({ fqdn, organizationId: projectId });
        yield* db
          .update(customDomain)
          .set({ lastCheckedAt: new Date(), verificationStatus: "verified" })
          .where(eq(customDomain.id, customDomainId));
        yield* sentFrom({ customDomainId, fqdn, organizationId: projectId });

        expect(yield* deleteCustomDomain({ customDomainId, organizationId: projectId })).toEqual({
          deleted: true,
        });

        // The Project's send history still names the Domain, so its row stays, with nothing
        // of its registration, and the SES identity is deleted all the same.
        expect(yield* domainOf(fqdn)).toEqual({
          dnsRecords: [],
          id: customDomainId,
          lastCheckedAt: null,
          organizations: [],
          registration: null,
          verificationStatus: "not_verified",
        });
        yield* runIdentityDeletes(enqueued, fqdn);
        expect(deletedIdentities).toEqual([{ fqdn, region: "eu-central-1" }]);

        // Its DKIM key is still the one its DNS publishes, so adding it again takes proof.
        scheduled.length = 0;
        expect(yield* createCustomDomain({ fqdn, organizationId: projectId })).toEqual({
          customDomainId,
          kind: "claim",
        });
        const readded = yield* domainOf(fqdn);
        expect(readded).toMatchObject({
          organizations: [
            { organizationId: projectId, ownershipVerificationStatus: "not_verified" },
          ],
          registration: { region: "eu-central-1" },
        });
        expect(readded?.dnsRecords.map((record) => record.purpose)).toContain("dkim");
        expect(scheduled).toContainEqual({
          name: "email.verify-ownership",
          payload: { customDomainId, organizationId: projectId },
        });

        // Once the Project and its Deliveries are gone, so is the Domain.
        const links = yield* linksOf(customDomainId);
        yield* db.delete(organization).where(eq(organization.id, projectId));
        yield* removeDeletedProjectDomains({
          links: links.map((link) => ({ ...link, customDomainId })),
          organizationId: projectId,
        });
        expect(yield* domainOf(fqdn)).toBeUndefined();
      }).pipe(Effect.provide(layer));
    },
  );

  it.live("a kept Domain whose claim is removed before it registers gets no identity", () => {
    let removeClaim: Effect.Effect<void> = Effect.void;
    const { createdIdentities, layer } = boundaries({ beforeKeyLoad: () => removeClaim });
    return Effect.gen(function* () {
      const services = yield* Effect.context<DB | Jobs>();
      const senderId = yield* insertProject();
      const claimantId = yield* insertProject();
      const fqdn = `${Bun.randomUUIDv7()}.example.test`;
      const { customDomainId } = yield* createCustomDomain({ fqdn, organizationId: senderId });
      yield* sentFrom({ customDomainId, fqdn, organizationId: senderId });
      yield* deleteCustomDomain({ customDomainId, organizationId: senderId });
      createdIdentities.length = 0;

      // The claim is written, then removed before the add reaches the registration.
      removeClaim = Effect.suspend(() => {
        removeClaim = Effect.void;
        return deleteCustomDomain({ customDomainId, organizationId: claimantId });
      }).pipe(Effect.provide(services), Effect.orDie);
      expect(
        yield* Effect.flip(createCustomDomain({ fqdn, organizationId: claimantId })),
      ).toMatchObject({
        message: "Domain was removed before it was registered with SES.",
        operation: "register_identity",
      });

      expect(createdIdentities).toEqual([]);
      expect(yield* domainOf(fqdn)).toMatchObject({
        dnsRecords: [],
        id: customDomainId,
        organizations: [],
        registration: null,
      });
    }).pipe(Effect.provide(layer));
  });

  /** A Domain left as a bare row: removed by the Project that sent from it. */
  const keptDomain = Effect.fn(function* () {
    const organizationId = yield* insertProject();
    const fqdn = `${Bun.randomUUIDv7()}.example.test`;
    const { customDomainId } = yield* createCustomDomain({ fqdn, organizationId });
    yield* sentFrom({ customDomainId, fqdn, organizationId });
    yield* deleteCustomDomain({ customDomainId, organizationId });
    return { customDomainId, fqdn };
  });

  it.live("a claim whose registration failed is checked, and adding it again registers it", () => {
    let sesDown = false;
    const { layer, scheduled } = boundaries({ failCreateIdentity: () => sesDown });
    return Effect.gen(function* () {
      const { customDomainId, fqdn } = yield* keptDomain();
      const claimantId = yield* insertProject();
      const claimCheck = {
        name: "email.verify-ownership",
        payload: { customDomainId, organizationId: claimantId },
      };
      scheduled.length = 0;

      sesDown = true;
      expect(
        yield* Effect.flip(createCustomDomain({ fqdn, organizationId: claimantId })),
      ).toMatchObject({ operation: "register_identity" });
      // The claim stands unregistered, with the check that will prove or lapse it.
      expect(yield* domainOf(fqdn)).toMatchObject({
        organizations: [
          { organizationId: claimantId, ownershipVerificationStatus: "not_verified" },
        ],
        registration: null,
      });
      expect(scheduled).toEqual([claimCheck]);

      sesDown = false;
      scheduled.length = 0;
      expect(yield* createCustomDomain({ fqdn, organizationId: claimantId })).toEqual({
        customDomainId,
        kind: "existing",
      });

      const registered = yield* domainOf(fqdn);
      expect(registered).toMatchObject({
        organizations: [
          { organizationId: claimantId, ownershipVerificationStatus: "not_verified" },
        ],
        registration: { region: "eu-central-1" },
      });
      expect(registered?.dnsRecords.map((record) => record.purpose)).toContain("dkim");
      expect(scheduled).toEqual([
        claimCheck,
        { name: "email.verify-custom-domain", payload: { customDomainId } },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.live("two claims made at once on an unregistered Domain both stand, checked", () => {
    const { createdIdentities, layer, scheduled } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const { customDomainId, fqdn } = yield* keptDomain();
      const claimantIds = [yield* insertProject(), yield* insertProject()];
      scheduled.length = 0;
      createdIdentities.length = 0;

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
        (yield* linksOf(customDomainId)).map((link) => link.organizationId).toSorted(),
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
      expect(enqueued.map((job) => job.payload)).toEqual([
        { fqdn, region: "eu-central-1" },
        { fqdn: orphan, region: "eu-central-1" },
      ]);
    }).pipe(Effect.provide(layer));
  });

  it.live(
    "the sweep of every Domain removes those without a link, and only those",
    () => {
      // A database of its own: the sweep reads every Domain, and in the shared one it would
      // take the Domains other tests have yet to link.
      const name = `sweep_${Bun.randomUUIDv7().replaceAll("-", "")}`;
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
      let refused: string | undefined;
      const { deletedIdentities, enqueued, layer } = boundaries({
        databaseUrl: url.href,
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

        const linked = yield* add();
        const unlinked = yield* add();
        yield* deleteProject(unlinked.organizationId);
        const bare = yield* add();
        yield* sentFrom({ ...bare, organizationId: senderIds[0] });
        yield* deleteCustomDomain(bare);
        const sent = yield* add();
        yield* sentFrom({ ...sent, organizationId: senderIds[1] });
        yield* deleteProject(sent.organizationId);
        const failing = yield* add();
        yield* deleteProject(failing.organizationId);
        refused = failing.fqdn;
        enqueued.length = 0;

        const kept = { dnsRecords: [], organizations: [], registration: null };
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
        expect(swept.bare).toMatchObject({ ...kept, id: bare.customDomainId });
        expect(swept.sent).toMatchObject({ ...kept, id: sent.customDomainId });
        // The one whose removal failed is as it was, and did not stop the others.
        expect(swept.failing).toMatchObject({
          id: failing.customDomainId,
          registration: { region: "eu-central-1" },
        });
        expect(
          enqueued.map((job) => (job.payload as { readonly fqdn: string }).fqdn).toSorted(),
        ).toEqual([unlinked.fqdn, sent.fqdn].toSorted());

        yield* removeUnlinkedDomains();

        expect(yield* after).toEqual(swept);
        expect(enqueued).toHaveLength(2);
        expect(deletedIdentities).toEqual([]);
      });

      return Effect.acquireUseRelease(
        admin(`create database "${name}"`),
        // Migrated here, so a migration that fails still has the database dropped. The
        // layer's pool is closed before it is.
        () =>
          Effect.promise(() => migrateOnStartup(url.href)).pipe(
            Effect.andThen(sweeps.pipe(Effect.provide(layer))),
          ),
        () => admin(`drop database "${name}" with (force)`),
      );
    },
    30_000,
  );
});
