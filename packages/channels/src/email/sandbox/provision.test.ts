import { describe, expect, it } from "@effect/vitest";
import { Jobs, type JobsService } from "@repo/jobs";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import { EmailBackend, type EmailBackendService } from "../backend";
import { EmailManagedDns, type EmailManagedDnsService } from "../managed-dns";
import { ensureSandboxDomain } from "./provision";

const unused = () => Effect.die("unused");

const unusedServices = Layer.mergeAll(
  Layer.succeed(EmailManagedDns, {
    cloudflareEnabled: true,
    reconcile: unused,
    remove: unused,
  } satisfies EmailManagedDnsService),
  Layer.succeed(EmailBackend, {
    createIdentity: unused,
    defaultRegion: "eu-central-1",
    deleteIdentity: unused,
    ensureInfrastructure: unused,
    getIdentityStatus: unused,
    send: unused,
  } satisfies EmailBackendService),
  Layer.succeed(Jobs, {
    cancel: unused,
    enqueue: unused,
    schedule: unused,
  } satisfies JobsService),
  Layer.succeed(SymmetricCrypto, {
    decrypt: unused,
    encrypt: unused,
  } as never),
);

const sandbox = {
  cloudflareZoneId: "zone_1",
  dkimPrivateKey: "sealed",
  dkimPublicKey: "pub",
  dkimSelector: "relayitabc",
  id: "sbxd_1",
  isActive: false,
  isPaused: false,
  rootDomain: "relayit.fyi",
  verificationStatus: "not_verified",
};

describe("ensureSandboxDomain", () => {
  it.effect("only sweeps when the sandbox is already registered", () => {
    const db = {
      query: {
        sandboxDomain: {
          findFirst: () => Effect.succeed({ ...sandbox, registration: { id: "epid_1" } }),
        },
      },
    };

    return ensureSandboxDomain({ cloudflareZoneId: "zone_1", rootDomain: "relayit.fyi" }).pipe(
      Effect.provide(Layer.mergeAll(unusedServices, Layer.succeed(DB, db as never))),
      Effect.map((allocated) => {
        expect(allocated).toBe(0);
        return allocated;
      }),
    );
  });

  it.effect(
    "registers an unregistered sandbox in the default region and schedules its verify",
    () => {
      const registrations: unknown[] = [];
      const owners: string[] = [];
      const scheduled: unknown[] = [];
      const db = {
        insert: () => ({
          values: (values: unknown) => {
            registrations.push(values);
            return Effect.void;
          },
        }),
        query: {
          sandboxDomain: {
            findFirst: () => Effect.succeed({ ...sandbox, registration: null }),
          },
        },
      };

      return ensureSandboxDomain({ cloudflareZoneId: "zone_1", rootDomain: "relayit.fyi" }).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(DB, db as never),
            Layer.succeed(EmailManagedDns, {
              cloudflareEnabled: true,
              reconcile: ({ owner }) => {
                owners.push(owner);
                return Effect.void;
              },
              remove: unused,
            } satisfies EmailManagedDnsService),
            Layer.succeed(EmailBackend, {
              createIdentity: ({ fqdn, region }) => {
                expect({ fqdn, region }).toEqual({ fqdn: "relayit.fyi", region: "eu-central-1" });
                return Effect.succeed({ mailFrom: { domain: "send.relayit.fyi", records: [] } });
              },
              defaultRegion: "eu-central-1",
              deleteIdentity: unused,
              ensureInfrastructure: unused,
              getIdentityStatus: unused,
              send: unused,
            } satisfies EmailBackendService),
            Layer.succeed(Jobs, {
              cancel: unused,
              enqueue: unused,
              schedule: (_contract: unknown, payload: unknown) => {
                scheduled.push(payload);
                return Effect.void;
              },
            } as never),
            Layer.succeed(SymmetricCrypto, {
              decrypt: () => Effect.succeed("private-key"),
              encrypt: unused,
            } as never),
          ),
        ),
        Effect.map(() => {
          expect(owners).toEqual(["sandbox:sbxd_1:identity"]);
          expect(registrations).toEqual([
            {
              region: "eu-central-1",
              sandboxDomainId: "sbxd_1",
              verificationStatus: "not_verified",
            },
          ]);
          expect(scheduled).toEqual([{ sandboxDomainId: "sbxd_1" }]);
          return null;
        }),
      );
    },
  );
});
