import { describe, expect, it } from "@effect/vitest";
import { Data, Effect } from "effect";
import {
  detachSesIdentityFromTenants,
  ensureSesTenant,
  type SesTenantClient,
  sesTenantNameFor,
} from "./tenant";

class AlreadyExistsException extends Data.TaggedError("AlreadyExistsException")<{
  readonly message: string;
}> {}

const ACCOUNT = "123456789012";
const REGION = "eu-central-1";
const tenantArn = (name: string) => `arn:aws:ses:${REGION}:${ACCOUNT}:tenant/${name}/tid-${name}`;

/** Stateful SES fake: tenants and (tenant, resourceArn) associations. */
const makeSes = () => {
  const tenants = new Set<string>();
  const associations = new Set<string>();
  const key = (tenant: string, arn: string) => `${tenant}|${arn}`;

  const ses = {
    createTenant: ({ TenantName }: { TenantName: string }) => {
      if (tenants.has(TenantName)) {
        return Effect.fail(new AlreadyExistsException({ message: "exists" }));
      }
      tenants.add(TenantName);
      return Effect.succeed({ TenantArn: tenantArn(TenantName) });
    },
    createTenantResourceAssociation: ({
      ResourceArn,
      TenantName,
    }: {
      ResourceArn: string;
      TenantName: string;
    }) => {
      if (associations.has(key(TenantName, ResourceArn))) {
        return Effect.fail(new AlreadyExistsException({ message: "exists" }));
      }
      associations.add(key(TenantName, ResourceArn));
      return Effect.succeed({});
    },
    deleteTenantResourceAssociation: ({
      ResourceArn,
      TenantName,
    }: {
      ResourceArn: string;
      TenantName: string;
    }) => {
      associations.delete(key(TenantName, ResourceArn));
      return Effect.succeed({});
    },
    getTenant: ({ TenantName }: { TenantName: string }) =>
      Effect.succeed({ Tenant: { TenantArn: tenantArn(TenantName) } }),
    listResourceTenants: ({ ResourceArn }: { ResourceArn: string }) =>
      Effect.succeed({
        ResourceTenants: [...associations]
          .map((entry) => entry.split("|"))
          .filter(([, arn]) => arn === ResourceArn)
          .map(([TenantName]) => ({ TenantName })),
      }),
    listTenants: () =>
      Effect.succeed({
        Tenants: [...tenants].map((name) => ({ TenantArn: tenantArn(name) })),
      }),
  } as unknown as SesTenantClient;

  return { associations, ses, tenants };
};

const identity = (fqdn: string) => `arn:aws:ses:${REGION}:${ACCOUNT}:identity/${fqdn}`;
const configurationSet = `arn:aws:ses:${REGION}:${ACCOUNT}:configuration-set/relayit-delivery-events`;

describe("ensureSesTenant", () => {
  it.effect(
    "creates the Project tenant and associates identity + configuration set, idempotently",
    () =>
      Effect.gen(function* () {
        const fake = makeSes();
        const tenantName = sesTenantNameFor("orgn_01kzxymmwxe8grtge77p0gr1g2");
        const ensure = ensureSesTenant(fake.ses, {
          identityFqdn: "tsavaro.com",
          region: REGION,
          tenantName,
        });

        yield* ensure;
        yield* ensure;

        expect(tenantName.length).toBeLessThanOrEqual(64);
        expect([...fake.tenants]).toEqual([tenantName]);
        expect(new Set(fake.associations)).toEqual(
          new Set([
            `${tenantName}|${identity("tsavaro.com")}`,
            `${tenantName}|${configurationSet}`,
          ]),
        );
      }),
  );
});

describe("detachSesIdentityFromTenants", () => {
  it.effect("removes a shared identity from every tenant and leaves other resources", () =>
    Effect.gen(function* () {
      const fake = makeSes();
      for (const project of ["orgn_a", "orgn_b"]) {
        yield* ensureSesTenant(fake.ses, {
          identityFqdn: "sandbox.relayit.io",
          region: REGION,
          tenantName: sesTenantNameFor(project),
        });
      }

      yield* detachSesIdentityFromTenants(fake.ses, {
        fqdn: "sandbox.relayit.io",
        region: REGION,
      });

      expect(new Set(fake.associations)).toEqual(
        new Set([
          `${sesTenantNameFor("orgn_a")}|${configurationSet}`,
          `${sesTenantNameFor("orgn_b")}|${configurationSet}`,
        ]),
      );
    }),
  );
});
