import { describe, expect, it } from "@effect/vitest";
import { DomainProvider } from "@repo/contracts/dashboard";
import { DOMAIN_PROVIDERS } from "@repo/persistence/db/schema";

describe("DomainProvider", () => {
  // The contract can't import the schema (the dashboard would bundle Drizzle), so it keeps
  // its own list; a Domain whose provider it lacks would fail to encode.
  it("lists every DNS host the database records", () => {
    expect(DomainProvider.literals).toEqual(DOMAIN_PROVIDERS);
  });
});
