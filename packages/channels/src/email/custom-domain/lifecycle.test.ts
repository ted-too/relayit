import { afterEach, describe, expect, mock, test } from "bun:test";
import { Jobs, type JobsService } from "@repo/jobs";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import { EmailBackend, type EmailBackendService } from "../backend";
import { EmailManagedDns, type EmailManagedDnsService } from "../managed-dns";
import { stubResolverNs } from "../verification/resolver-test-stub";
import { createCustomDomain, pauseCustomDomain, unpauseCustomDomain } from "./lifecycle";

const unsupported = () => Effect.die("unused");

const backend = (overrides: Partial<EmailBackendService> = {}) =>
  Layer.succeed(EmailBackend, {
    createIdentity: unsupported,
    defaultRegion: "eu-central-1",
    deleteIdentity: unsupported,
    ensureInfrastructure: unsupported,
    getIdentityStatus: unsupported,
    send: unsupported,
    ...overrides,
  } satisfies EmailBackendService);

const unusedCreateServices = Layer.mergeAll(
  Layer.succeed(EmailManagedDns, {
    cloudflareEnabled: false,
    reconcile: unsupported,
    remove: unsupported,
  } satisfies EmailManagedDnsService),
  backend(),
  Layer.succeed(Jobs, {
    cancel: unsupported,
    enqueue: unsupported,
    schedule: unsupported,
  } satisfies JobsService),
  Layer.succeed(SymmetricCrypto, {
    decrypt: unsupported,
    encrypt: unsupported,
  } as never),
);

afterEach(() => {
  mock.restore();
});

const stubCloudflareNs = () => {
  stubResolverNs({ "acme.test": ["ada.ns.cloudflare.com"] });
};

describe("pauseCustomDomain / unpauseCustomDomain", () => {
  test("rejects pause when the Project is not linked to the domain", () => {
    const db: any = {
      query: {
        organizationDomain: {
          findFirst: () => Effect.succeed(null),
        },
      },
    };

    return Effect.runPromise(
      pauseCustomDomain({
        customDomainId: "dom_1",
        organizationId: "org_1",
        reason: "manual_admin_pause",
      }).pipe(
        Effect.provide(Layer.succeed(DB, db)),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            _tag: "CustomDomainError",
            message: "Domain is not linked to this Project.",
          });
          return error;
        }),
      ),
    );
  });

  test("pauses and unpauses a linked custom domain", () => {
    const updates: unknown[] = [];
    const db: any = {
      query: {
        organizationDomain: {
          findFirst: () =>
            Effect.succeed({
              customDomainId: "dom_1",
              organizationId: "org_1",
            }),
        },
      },
      update: () => ({
        set: (values: unknown) => ({
          where: () => {
            updates.push(values);
            return Effect.void;
          },
        }),
      }),
    };

    return Effect.runPromise(
      Effect.gen(function* () {
        const paused = yield* pauseCustomDomain({
          customDomainId: "dom_1",
          organizationId: "org_1",
          reason: "bad_reputation",
        });
        expect(paused).toEqual({ customDomainId: "dom_1", isPaused: true });

        const unpaused = yield* unpauseCustomDomain({
          customDomainId: "dom_1",
          organizationId: "org_1",
        });
        expect(unpaused).toEqual({ customDomainId: "dom_1", isPaused: false });
        expect(updates).toEqual([
          { isPaused: true, pausedReason: "bad_reputation" },
          { isPaused: false, pausedReason: null },
        ]);
      }).pipe(Effect.provide(Layer.succeed(DB, db))),
    );
  });
});

describe("createCustomDomain claim guard", () => {
  test("rejects a second pending claim on a held FQDN", () => {
    const db: any = {
      query: {
        customDomain: {
          findFirst: () =>
            Effect.succeed({
              fqdn: "acme.test",
              id: "dom_held",
              organizations: [
                {
                  organizationId: "org_owner",
                  ownershipVerificationStatus: "verified",
                },
                {
                  organizationId: "org_pending",
                  ownershipVerificationStatus: "not_verified",
                },
              ],
              registration: null,
            }),
        },
      },
    };

    return Effect.runPromise(
      createCustomDomain({
        fqdn: "acme.test",
        organizationId: "org_claimant",
      }).pipe(
        Effect.provide(Layer.merge(Layer.succeed(DB, db), unusedCreateServices)),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            message: "Another Project already has a pending claim on this domain.",
            operation: "claim",
          });
          return error;
        }),
      ),
    );
  });

  test("returns existing when the Project is already linked", () => {
    const db: any = {
      query: {
        customDomain: {
          findFirst: () =>
            Effect.succeed({
              fqdn: "acme.test",
              id: "dom_1",
              organizations: [
                {
                  organizationId: "org_1",
                  ownershipVerificationStatus: "verified",
                },
              ],
              registration: null,
            }),
        },
      },
    };

    return Effect.runPromise(
      createCustomDomain({
        fqdn: "acme.test",
        organizationId: "org_1",
      }).pipe(
        Effect.provide(Layer.merge(Layer.succeed(DB, db), unusedCreateServices)),
        Effect.map((result) => {
          expect(result).toEqual({
            customDomainId: "dom_1",
            kind: "existing",
          });
          return result;
        }),
      ),
    );
  });

  test("detects the DNS host when reclaiming an unknown domain", () => {
    stubCloudflareNs();
    const providerUpdates: unknown[] = [];
    const db: any = {
      insert: () => ({
        values: () => Effect.void,
      }),
      query: {
        customDomain: {
          findFirst: () =>
            Effect.succeed({
              fqdn: "acme.test",
              id: "dom_1",
              organizations: [],
              provider: "unknown",
              registration: null,
            }),
        },
      },
      update: () => ({
        set: (values: unknown) => ({
          where: () => {
            providerUpdates.push(values);
            return Effect.void;
          },
        }),
      }),
    };

    return Effect.runPromise(
      createCustomDomain({
        fqdn: "acme.test",
        organizationId: "org_1",
      }).pipe(
        Effect.provide(Layer.merge(Layer.succeed(DB, db), unusedCreateServices)),
        Effect.map((result) => {
          expect(result).toEqual({
            customDomainId: "dom_1",
            kind: "existing",
          });
          expect(providerUpdates).toEqual([{ provider: "cloudflare" }]);
          return result;
        }),
      ),
    );
  });

  test("persists the detected DNS host on a new custom domain", () => {
    stubCloudflareNs();
    const domainInserts: Array<{ provider?: string }> = [];
    const registrationInserts: Array<{ region?: string }> = [];
    const db: any = {
      insert: () => ({
        values: (values: { provider?: string; region?: string }) => {
          const effect = Effect.succeed([{ id: "dom_new" }]);
          if (values.provider !== undefined) {
            domainInserts.push(values);
          }
          if (values.region !== undefined) {
            registrationInserts.push(values);
          }
          return Object.assign(effect, {
            returning: () =>
              Effect.succeed([
                {
                  dkimPrivateKey: "enc",
                  dkimPublicKey: "pub",
                  dkimSelector: "sel",
                  fqdn: "acme.test",
                  id: "dom_new",
                },
              ]),
          });
        },
      }),
      query: {
        customDomain: {
          findFirst: () => Effect.succeed(null),
        },
      },
    };

    const createServices = Layer.mergeAll(
      Layer.succeed(EmailManagedDns, {
        cloudflareEnabled: false,
        reconcile: () => Effect.void,
        remove: unsupported,
      } satisfies EmailManagedDnsService),
      backend({
        createIdentity: ({ region }) => {
          expect(region).toBe("eu-central-1");
          return Effect.succeed({ mailFrom: { domain: "send.acme.test", records: [] } });
        },
      }),
      Layer.succeed(Jobs, {
        cancel: unsupported,
        enqueue: unsupported,
        schedule: () => Effect.void,
      } satisfies JobsService),
      Layer.succeed(SymmetricCrypto, {
        decrypt: unsupported,
        encrypt: () => Effect.succeed("encrypted"),
      } as never),
    );

    return Effect.runPromise(
      createCustomDomain({
        fqdn: "acme.test",
        organizationId: "org_1",
      }).pipe(
        Effect.provide(Layer.merge(Layer.succeed(DB, db), createServices)),
        Effect.map((result) => {
          expect(result).toEqual({
            customDomainId: "dom_new",
            kind: "created",
          });
          expect(domainInserts[0]?.provider).toBe("cloudflare");
          expect(registrationInserts).toMatchObject([{ region: "eu-central-1" }]);
          return result;
        }),
      ),
    );
  });
});
