import { afterEach, describe, expect, mock, test } from "bun:test";
import { Jobs, type JobsService } from "@repo/jobs";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import { EmailBackend, type EmailBackendService } from "../backend";
import { emailVerifyCustomDomainHandler } from "./handlers";
import { stubResolverNs } from "./resolver-test-stub";

const unsupported = () => Effect.die("unused");
const execution = { attempt: 1, enqueuedAt: Date.now(), id: "job_1" };

afterEach(() => {
  mock.restore();
});

describe("emailVerifyCustomDomainHandler", () => {
  test("updates the stored DNS host when nameservers have changed", () => {
    stubResolverNs({ "acme.test": ["ns-1234.awsdns-12.com"] });

    const providerUpdates: unknown[] = [];
    const db: any = {
      query: {
        customDomain: {
          findFirst: () =>
            Effect.succeed({
              fqdn: "acme.test",
              id: "dom_1",
              provider: "cloudflare",
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
      emailVerifyCustomDomainHandler.handle({ customDomainId: "dom_1" }, execution).pipe(
        Effect.provide(
          Layer.mergeAll(
            Layer.succeed(DB, db),
            Layer.succeed(Jobs, {
              cancel: () => Effect.void,
              enqueue: unsupported,
              schedule: unsupported,
            } satisfies JobsService),
            Layer.succeed(EmailBackend, {
              createIdentity: unsupported,
              defaultRegion: "eu-central-1",
              deleteIdentity: unsupported,
              ensureInfrastructure: unsupported,
              getIdentityStatus: unsupported,
              send: unsupported,
            } satisfies EmailBackendService),
          ),
        ),
        Effect.map(() => {
          expect(providerUpdates).toEqual([{ provider: "route53" }]);
          return true;
        }),
      ),
    );
  });
});
