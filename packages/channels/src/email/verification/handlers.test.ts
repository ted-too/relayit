import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import * as dns from "node:dns";
import { Jobs, type JobsService } from "@repo/jobs";
import { ProviderCredentialsVault } from "@repo/persistence/crypto/provider-credentials";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import {
  EmailProviderRegistry,
  type EmailProviderRegistryService,
} from "../provider-registry";
import { emailVerifyCustomDomainHandler } from "./handlers";

const unsupported = () => Effect.die("unused");
const execution = { attempt: 1, enqueuedAt: Date.now(), id: "job_1" };

afterEach(() => {
  mock.restore();
});

describe("emailVerifyCustomDomainHandler", () => {
  test("updates the stored DNS host when nameservers have changed", () => {
    spyOn(dns.promises, "resolveNs").mockImplementation((host) => {
      if (host === "acme.test") {
        return Promise.resolve(["ns-1234.awsdns-12.com"]);
      }
      return Promise.reject(
        Object.assign(new Error("not found"), { code: "ENOTFOUND" })
      );
    });

    const providerUpdates: unknown[] = [];
    const db: any = {
      query: {
        customDomain: {
          findFirst: () =>
            Effect.succeed({
              fqdn: "acme.test",
              id: "dom_1",
              provider: "cloudflare",
              providerIdentities: [],
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
      emailVerifyCustomDomainHandler
        .handle({ customDomainId: "dom_1" }, execution)
        .pipe(
          Effect.provide(
            Layer.mergeAll(
              Layer.succeed(DB, db),
              Layer.succeed(Jobs, {
                cancel: () => Effect.void,
                enqueue: unsupported,
                schedule: unsupported,
              } satisfies JobsService),
              Layer.succeed(EmailProviderRegistry, {
                get: unsupported,
              } satisfies EmailProviderRegistryService),
              Layer.succeed(ProviderCredentialsVault, {
                open: unsupported,
                seal: unsupported,
              } as never)
            )
          ),
          Effect.map(() => {
            expect(providerUpdates).toEqual([{ provider: "route53" }]);
            return true;
          })
        )
    );
  });
});
