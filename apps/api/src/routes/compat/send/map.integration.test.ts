import { afterAll, describe, expect, test } from "bun:test";
import { createPromiseDb } from "@repo/persistence/db/promise";
import { customDomain, organization, organizationDomain } from "@repo/persistence/db/schema";
import { typeid } from "typeid-js";
import { resolveLegacyDefaultFromAddress } from "./map";

const testDatabaseUrl = Bun.env.TEST_DATABASE_URL;
const testName = "legacy default from uses the oldest sendable custom Domain of the Project";

describe("resolveLegacyDefaultFromAddress (PostgreSQL)", () => {
  if (!testDatabaseUrl) {
    process.emitWarning("Skipping legacy default from test: TEST_DATABASE_URL is not set");
    // biome-ignore lint/suspicious/noSkippedTests: The PostgreSQL test is opt-in.
    test.skip(testName, () => undefined);
    return;
  }

  const db = createPromiseDb({ databaseUrl: testDatabaseUrl });
  const organizationIds: string[] = [];
  const customDomainIds: string[] = [];

  afterAll(async () => {
    await db.$client.query("delete from custom_domain where id = any($1)", [customDomainIds]);
    await db.$client.query("delete from organization where id = any($1)", [organizationIds]);
    await db.$client.end();
  });

  const insertOrganization = async () => {
    const id = typeid("orgn").toString();
    organizationIds.push(id);
    await db.insert(organization).values({
      id,
      name: "Legacy default from",
      slug: `legacy-from-${Bun.randomUUIDv7()}`,
    });
    return id;
  };

  const linkDomain = async (input: {
    readonly createdAt: Date;
    readonly isPaused?: boolean;
    readonly organizationId: string;
    readonly verificationStatus: "not_verified" | "verified";
  }) => {
    const id = typeid("domn").toString();
    const fqdn = `${Bun.randomUUIDv7()}.legacy-from.test`;
    customDomainIds.push(id);
    await db.insert(customDomain).values({
      dkimPrivateKey: "private",
      dkimPublicKey: "public",
      dkimSelector: "relayit",
      fqdn,
      id,
      isPaused: input.isPaused ?? false,
      verificationStatus: input.verificationStatus,
    });
    await db.insert(organizationDomain).values({
      createdAt: input.createdAt,
      customDomainId: id,
      organizationId: input.organizationId,
      ownershipToken: `tok_${Bun.randomUUIDv7()}`,
    });
    return fqdn;
  };

  test(testName, async () => {
    const organizationId = await insertOrganization();
    const otherOrganizationId = await insertOrganization();

    await linkDomain({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      organizationId,
      verificationStatus: "not_verified",
    });
    await linkDomain({
      createdAt: new Date("2026-01-02T00:00:00.000Z"),
      isPaused: true,
      organizationId,
      verificationStatus: "verified",
    });
    await linkDomain({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      organizationId: otherOrganizationId,
      verificationStatus: "verified",
    });
    const oldestSendable = await linkDomain({
      createdAt: new Date("2026-01-03T00:00:00.000Z"),
      organizationId,
      verificationStatus: "verified",
    });
    await linkDomain({
      createdAt: new Date("2026-01-04T00:00:00.000Z"),
      organizationId,
      verificationStatus: "verified",
    });

    expect(await resolveLegacyDefaultFromAddress({ db, organizationId })).toBe(
      `noreply@${oldestSendable}`,
    );
  });

  test("falls back to null without a sendable custom or Sandbox Domain", async () => {
    const organizationId = await insertOrganization();
    await linkDomain({
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      organizationId,
      verificationStatus: "not_verified",
    });

    expect(await resolveLegacyDefaultFromAddress({ db, organizationId })).toBeNull();
  });
});
