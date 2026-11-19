/**
 * Setting up the Sandbox Domain against a real Postgres: that it is never made on a name a
 * Project holds as a custom Domain. SES, Cloudflare and the job queue are the boundaries
 * stubbed.
 */
import { describe, expect, it, test } from "@effect/vitest";
import { Jobs, type JobsService } from "@repo/jobs";
import { parseBetterAuthSecrets } from "@repo/persistence/crypto/auth-secrets";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB, makeDbLive } from "@repo/persistence/db/effect";
import {
  customDomain,
  emailDomainRegistration,
  organization,
  organizationDomain,
  sandboxDomain,
} from "@repo/persistence/db/schema";
import { eq, sql } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { typeid } from "typeid-js";
import { EmailBackend, EmailBackendIdentityConflict } from "../backend";
import { createOwnershipToken } from "../custom-domain/dns";
import { EmailManagedDns } from "../managed-dns";
import { ensureSandboxDomain } from "./provision";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;

describe("ensureSandboxDomain (PostgreSQL)", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping Sandbox Domain tests: TEST_DATABASE_URL is not set");
    // The PostgreSQL test is opt-in.
    test.skip("ensureSandboxDomain", () => undefined);
    return;
  }

  /** SES, Cloudflare and the queue, and what each was asked to do. */
  const boundaries = (options: { readonly outsideIdentity?: () => string | undefined } = {}) => {
    const createdIdentities: string[] = [];
    const dnsOwners: string[] = [];
    const scheduled: unknown[] = [];
    const layer = Layer.mergeAll(
      Layer.succeed(EmailBackend, {
        createIdentity: ({ fqdn, region }) =>
          fqdn === options.outsideIdentity?.()
            ? Effect.fail(
                new EmailBackendIdentityConflict({ fqdn, region: region ?? "eu-central-1" }),
              )
            : Effect.sync(() => {
                createdIdentities.push(fqdn);
                return { mailFrom: { domain: `send.${fqdn}`, records: [] } };
              }),
        defaultRegion: "eu-central-1",
        deleteIdentity: () => Effect.die("unused"),
        ensureInfrastructure: () => Effect.die("unused"),
        getIdentityStatus: () => Effect.die("unused"),
        getProjectSendingStatus: () => Effect.die("unused"),
        send: () => Effect.die("unused"),
      }),
      Layer.succeed(EmailManagedDns, {
        cloudflareEnabled: true,
        reconcile: ({ owner }) =>
          Effect.sync(() => {
            dnsOwners.push(owner);
          }),
        remove: () => Effect.die("unused"),
      }),
      Layer.succeed(Jobs, {
        cancel: () => Effect.die("unused"),
        enqueue: () => Effect.die("unused"),
        schedule: ((_contract: unknown, payload: unknown) => {
          scheduled.push(payload);
          return Effect.void;
        }) as JobsService["schedule"],
      }),
      SymmetricCrypto.live(parseBetterAuthSecrets("1:sandbox-test-secret-0123456789abc")),
    ).pipe(Layer.provideMerge(makeDbLive({ databaseUrl: testDatabaseUrl })));
    return { createdIdentities, dnsOwners, layer, scheduled };
  };

  /** A custom Domain a Project holds, as an add left it. */
  const heldDomain = Effect.fn(function* (fqdn: string) {
    const db = yield* DB;
    const organizationId = typeid("orgn").toString();
    yield* db
      .insert(organization)
      .values({ id: organizationId, name: "Holder", slug: `holder-${organizationId}` });
    const [domain] = yield* db
      .insert(customDomain)
      .values({ dkimPrivateKey: "private", dkimPublicKey: "public", dkimSelector: "s", fqdn })
      .returning({ id: customDomain.id });
    const customDomainId = domain?.id ?? (yield* Effect.die("The Domain was written"));
    yield* db.insert(organizationDomain).values({
      customDomainId,
      organizationId,
      ownershipToken: createOwnershipToken(),
      ownershipVerificationStatus: "verified",
    });
    return customDomainId;
  });

  const sandboxesOn = Effect.fn(function* (root: string) {
    const db = yield* DB;
    return yield* db
      .select({ id: sandboxDomain.id })
      .from(sandboxDomain)
      .where(sql`lower(${sandboxDomain.rootDomain}) = lower(${root})`);
  });

  const newRoot = () => `${Bun.randomUUIDv7()}.sandbox.test`;

  it.live.each([
    { held: (root: string) => root, what: "the root itself" },
    { held: (root: string) => `mail.${root}`, what: "a name under it" },
    { held: (root: string) => `a.b.${root}`, what: "a name deeper under it" },
  ])("is not set up on a root where a Project holds $what", ({ held }) => {
    const { createdIdentities, dnsOwners, layer, scheduled } = boundaries();
    return Effect.gen(function* () {
      const root = newRoot();
      const customDomainId = yield* heldDomain(held(root));

      // As configured: a Domain's FQDN is stored lowercased, `CF_ROOT_DOMAIN` as typed.
      const refused = yield* Effect.flip(
        ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root.toUpperCase() }),
      );

      expect(refused).toMatchObject({
        _tag: "SandboxDomainRootHeld",
        customDomainId,
        fqdn: held(root),
        rootDomain: root.toUpperCase(),
      });
      expect(yield* sandboxesOn(root)).toEqual([]);
      expect({ createdIdentities, dnsOwners, scheduled }).toEqual({
        createdIdentities: [],
        dnsOwners: [],
        scheduled: [],
      });
    }).pipe(Effect.provide(layer));
  });

  it.live("is not registered on a root a Project holds, when its row is already there", () => {
    const { createdIdentities, dnsOwners, layer, scheduled } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const root = newRoot();
      // As a start left it that wrote the row and failed before SES: unregistered.
      yield* db.insert(sandboxDomain).values({
        cloudflareZoneId: "zone",
        dkimPrivateKey: "private",
        dkimPublicKey: "public",
        dkimSelector: "relayit",
        rootDomain: root,
      });
      yield* heldDomain(root);

      expect(
        yield* Effect.flip(ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root })),
      ).toMatchObject({ _tag: "SandboxDomainRootHeld" });

      const [sandbox] = yield* sandboxesOn(root);
      expect(
        yield* db
          .select({ id: emailDomainRegistration.id })
          .from(emailDomainRegistration)
          .where(eq(emailDomainRegistration.sandboxDomainId, sandbox?.id ?? "")),
      ).toEqual([]);
      expect({ createdIdentities, dnsOwners, scheduled }).toEqual({
        createdIdentities: [],
        dnsOwners: [],
        scheduled: [],
      });
    }).pipe(Effect.provide(layer));
  });

  it.live("is not registered onto an SES identity Relayit did not make, at any start", () => {
    let root: string | undefined;
    const { createdIdentities, layer, scheduled } = boundaries({ outsideIdentity: () => root });
    return Effect.gen(function* () {
      const db = yield* DB;
      root = newRoot();

      // The first start writes the Sandbox Domain and is refused by SES; the next finds its
      // row unregistered and is refused the same.
      for (const _start of [1, 2]) {
        expect(
          yield* Effect.flip(ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root })),
        ).toMatchObject({
          _tag: "SandboxDomainError",
          cause: { _tag: "EmailBackendIdentityConflict", fqdn: root },
          message:
            "The sandbox root already has an SES identity that Relayit did not create; it was left untouched.",
        });
      }

      const sandboxes = yield* sandboxesOn(root);
      expect(sandboxes).toHaveLength(1);
      expect(
        yield* db
          .select({ id: emailDomainRegistration.id })
          .from(emailDomainRegistration)
          .where(eq(emailDomainRegistration.sandboxDomainId, sandboxes[0]?.id ?? "")),
      ).toEqual([]);
      expect({ createdIdentities, scheduled }).toEqual({ createdIdentities: [], scheduled: [] });
    }).pipe(Effect.provide(layer));
  });

  it.live("is set up beside a Domain whose name only ends with the root's letters", () => {
    const { createdIdentities, layer, scheduled } = boundaries();
    return Effect.gen(function* () {
      const db = yield* DB;
      const root = newRoot();
      yield* heldDomain(`x${root}`);

      yield* ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root });

      const [sandbox] = yield* sandboxesOn(root);
      expect(createdIdentities).toEqual([root]);
      expect(scheduled).toEqual([{ sandboxDomainId: sandbox?.id }]);
      expect(
        yield* db
          .select({ region: emailDomainRegistration.region })
          .from(emailDomainRegistration)
          .where(eq(emailDomainRegistration.sandboxDomainId, sandbox?.id ?? "")),
      ).toEqual([{ region: "eu-central-1" }]);

      // Once it is registered, a Domain found on its root does not stop the next start: the
      // identity is the Sandbox Domain's by then, and nothing is created.
      yield* heldDomain(root);
      expect(yield* ensureSandboxDomain({ cloudflareZoneId: "zone", rootDomain: root })).toBe(0);
      expect(createdIdentities).toEqual([root]);
    }).pipe(Effect.provide(layer));
  });
});
