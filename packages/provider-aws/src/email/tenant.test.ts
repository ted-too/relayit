import { describe, expect, it } from "@effect/vitest";
import { Data, Effect } from "effect";
import {
  detachSesIdentityFromTenants,
  ensureSesTenant,
  type SesTenantClient,
  sesTenantSendingStatus,
} from "./tenant";
import { projectIdFromSesTenantName, sesTenantNameFor } from "./tenant-name";

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

describe("projectIdFromSesTenantName", () => {
  it("reads back the Project a tenant was named for, and nothing from any other name", () => {
    const projectId = "orgn_01k53s8sz5ecvvtqrh902mrhfc";
    expect(sesTenantNameFor(projectId)).toBe("relayit-orgn_01k53s8sz5ecvvtqrh902mrhfc");
    expect(projectIdFromSesTenantName(sesTenantNameFor(projectId))).toBe(projectId);
    expect(projectIdFromSesTenantName("acme-orgn_01k53s8sz5ecvvtqrh902mrhfc")).toBeUndefined();
    expect(projectIdFromSesTenantName(sesTenantNameFor(""))).toBeUndefined();
  });
});

describe("sesTenantSendingStatus", () => {
  class NotFoundException extends Data.TaggedError("NotFoundException")<{
    readonly message: string;
  }> {}
  const TENANT = sesTenantNameFor("orgn_test");

  /** SES holding one tenant, answering as it did on 2026-11-18 for each status set by hand. */
  const sesWith = (entity: Record<string, unknown> | "no tenant") => {
    const asked: unknown[] = [];
    const ses = {
      getReputationEntity: (input: unknown) => {
        asked.push(input);
        return Effect.succeed({ ReputationEntity: entity });
      },
      getTenant: ({ TenantName }: { TenantName: string }) =>
        entity === "no tenant"
          ? Effect.fail(new NotFoundException({ message: "no such tenant" }))
          : Effect.succeed({
              // GetTenant's own status always says enabled here, so only the aggregate can
              // be what is read.
              Tenant: { SendingStatus: "ENABLED", TenantArn: tenantArn(TenantName) },
            }),
    } as unknown as SesTenantClient;
    return { asked, ses };
  };

  it.effect("reads the aggregate of the tenant's two statuses", () =>
    Effect.gen(function* () {
      const byHand = (Status: string) => ({
        AwsSesManagedStatus: null,
        CustomerManagedStatus: { Status },
        SendingStatusAggregate: Status,
      });
      const { asked, ses } = sesWith(byHand("DISABLED"));
      expect(yield* sesTenantSendingStatus(ses, TENANT)).toBe("paused");
      expect(asked).toEqual([
        { ReputationEntityReference: tenantArn(TENANT), ReputationEntityType: "RESOURCE" },
      ]);

      expect(yield* sesTenantSendingStatus(sesWith(byHand("REINSTATED")).ses, TENANT)).toBe(
        "enabled",
      );
      expect(yield* sesTenantSendingStatus(sesWith(byHand("ENABLED")).ses, TENANT)).toBe("enabled");
      // A tenant nobody has touched.
      expect(
        yield* sesTenantSendingStatus(
          sesWith({
            AwsSesManagedStatus: null,
            CustomerManagedStatus: null,
            SendingStatusAggregate: "ENABLED",
          }).ses,
          TENANT,
        ),
      ).toBe("enabled");
      // SES's own pause holds whatever the owner's status says.
      expect(
        yield* sesTenantSendingStatus(
          sesWith({
            AwsSesManagedStatus: { Status: "DISABLED" },
            CustomerManagedStatus: { Status: "REINSTATED" },
            SendingStatusAggregate: "DISABLED",
          }).ses,
          TENANT,
        ),
      ).toBe("paused");
    }),
  );

  it.effect("answers absent for a Project with no tenant in the region", () =>
    Effect.gen(function* () {
      const { asked, ses } = sesWith("no tenant");
      expect(yield* sesTenantSendingStatus(ses, TENANT)).toBe("absent");
      expect(asked).toEqual([]);
    }),
  );

  it.effect("fails on a status it does not know, so nothing is paused or unpaused by it", () =>
    Effect.gen(function* () {
      for (const SendingStatusAggregate of [undefined, "SUSPENDED"]) {
        const error = yield* Effect.flip(
          sesTenantSendingStatus(sesWith({ SendingStatusAggregate }).ses, TENANT),
        );
        expect(error).toMatchObject({
          _tag: "AwsUnexpectedResponseError",
          operation: "GetReputationEntity",
        });
      }
    }),
  );
});
