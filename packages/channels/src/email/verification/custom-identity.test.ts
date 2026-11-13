import { describe, expect, test } from "bun:test";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import { EmailBackend, type EmailBackendService } from "../backend";
import { DnsLookups } from "../dns-lookups";
import { verifyCustomDomainRegistration } from "./custom-identity";

const unsupported = () => Effect.die("unused");
const from = new Date();

const verify = (identity: { readonly dkimVerified: boolean; readonly verified: boolean }) => {
  const updates: Record<string, unknown>[] = [];
  const asked: unknown[] = [];
  const db: any = {
    query: {
      emailDnsRecord: {
        findMany: () =>
          Effect.succeed([
            { id: "edns_1", name: "a._domainkey.acme.test", status: "active" },
            { id: "edns_2", name: "_dmarc.acme.test", status: "active" },
          ]),
      },
    },
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => {
          updates.push(values);
          return Effect.void;
        },
      }),
    }),
  };

  return Effect.runPromise(
    verifyCustomDomainRegistration({
      db,
      domain: { fqdn: "acme.test", id: "dom_1", verifyBackoffLevel: 0 },
      registration: {
        createdAt: from,
        customDomainId: "dom_1",
        id: "epid_1",
        region: null,
        sandboxDomainId: null,
        verificationStatus: "not_verified",
      },
    }).pipe(
      Effect.provide(
        Layer.mergeAll(
          Layer.succeed(DB, db),
          Layer.succeed(DnsLookups, {
            detectProvider: () => Promise.resolve("unknown"),
            evaluate: () => Promise.resolve({ matches: true, warnings: [] }),
          }),
          Layer.succeed(EmailBackend, {
            createIdentity: unsupported,
            defaultRegion: "eu-central-1",
            deleteIdentity: unsupported,
            ensureInfrastructure: unsupported,
            getIdentityStatus: (input) => {
              asked.push(input);
              return Effect.succeed(identity);
            },
            send: unsupported,
          } satisfies EmailBackendService),
        ),
      ),
      Effect.map((result) => ({ asked, result, updates })),
    ),
  );
};

const minutesAhead = (date: Date) => Math.round((date.getTime() - Date.now()) / 60_000);

describe("verifyCustomDomainRegistration", () => {
  test("asks SES in the registration's region and records what it says", async () => {
    const { asked, updates } = await verify({ dkimVerified: true, verified: true });

    expect(asked).toEqual([{ fqdn: "acme.test", region: null }]);
    expect(updates[0]).toEqual({ verificationStatus: "verified" });
  });

  test("keeps polling SES often while it lags DNS records that are all published", async () => {
    const { result, updates } = await verify({ dkimVerified: false, verified: false });

    expect(updates[0]).toEqual({ verificationStatus: "not_verified" });
    expect(minutesAhead(result.nextCheckAt)).toBe(2);
  });

  test("checks a verified domain twice a day", async () => {
    const { result } = await verify({ dkimVerified: true, verified: true });

    expect(result.verificationStatus).toBe("verified");
    expect(minutesAhead(result.nextCheckAt)).toBe(12 * 60);
  });
});
