/**
 * Adding a Domain against a real Postgres: who ends up holding it, and whether it ends up
 * registered and checked. SES, public DNS and the job queue are the boundaries stubbed.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { Jobs, type JobsService } from "@repo/jobs";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import { customDomain, organization, organizationDomain } from "@repo/persistence/db/schema";
import { and, eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { typeid } from "typeid-js";
import { EmailBackend, EmailBackendUnavailable } from "../backend";
import { DnsLookups } from "../dns-lookups";
import { EmailManagedDns } from "../managed-dns";
import { ownershipChallengeValue } from "./dns";
import { verifyCustomDomainOwnership } from "../verification/custom-identity";
import { emailVerifyOwnershipHandler } from "../verification/handlers";
import { CLAIM_TTL_MS, createCustomDomain } from "./lifecycle";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

describe("createCustomDomain (PostgreSQL)", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping Domain lifecycle tests: TEST_DATABASE_URL is not set");
    // The PostgreSQL test is opt-in.
    test.skip("createCustomDomain", () => undefined);
    return;
  }

  /**
   * SES, public DNS and the queue as each test sets them; what was scheduled, by job, and
   * the TXT values published in DNS.
   */
  const boundaries = (options: { readonly failCreateIdentity?: () => boolean } = {}) => {
    const scheduled: { readonly name: string; readonly payload: unknown }[] = [];
    const published = new Set<string>();
    const cancelled: { readonly name: string; readonly payload: unknown }[] = [];
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
            : Effect.succeed({ mailFrom: { domain: `send.${fqdn}`, records: [] } }),
        defaultRegion: "eu-central-1",
        deleteIdentity: () => Effect.void,
        ensureInfrastructure: () => Effect.void,
        getIdentityStatus: () => Effect.die("unused"),
        send: () => Effect.die("unused"),
      }),
      Layer.succeed(DnsLookups, {
        detectProvider: () => Promise.resolve("cloudflare"),
        evaluate: ({ value }) => Promise.resolve({ matches: published.has(value), warnings: [] }),
      }),
      Layer.succeed(Jobs, {
        cancel: ((contract: { readonly name: string }, payload?: unknown) => {
          cancelled.push({ name: contract.name, payload });
          return Effect.void;
        }) as JobsService["cancel"],
        enqueue: () => Effect.die("unused"),
        schedule: ((contract: { readonly name: string }, payload: unknown) => {
          scheduled.push({ name: contract.name, payload });
          return Effect.void;
        }) as JobsService["schedule"],
      }),
      EmailManagedDns.noop(),
      SymmetricCrypto.live(parseBetterAuthSecrets("1:lifecycle-test-secret-0123456789")),
    ).pipe(Layer.provideMerge(makeDbLive({ databaseUrl: testDatabaseUrl })));
    return { cancelled, layer, published, scheduled };
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
});
