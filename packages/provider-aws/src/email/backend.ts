import { EmailProviderRegistry } from "@repo/channels/email/provider-registry";
import { DnsLookups } from "@repo/channels/email/dns-lookups";
import { Data, Effect, Layer } from "effect";
import { makeFakeSesProviderFactory } from "./fake";
import { awsSesProviderFactory } from "./runtime";

/** What email goes through: SES, or the local stand-in in `./fake.ts`. */
export type EmailBackend = "fake" | "ses";

export class FakeEmailBackendInProduction extends Data.TaggedError("FakeEmailBackendInProduction")<{
  readonly message: string;
}> {}

/**
 * `EMAIL_BACKEND` when set. Otherwise fake only when NODE_ENV says development or test:
 * the api, worker and builder images don't set NODE_ENV, so an unset one must keep meaning SES.
 */
export const selectEmailBackend = (input: {
  readonly configured: EmailBackend | undefined;
  readonly nodeEnv: string | undefined;
}) =>
  Effect.gen(function* () {
    if (input.configured === "fake" && input.nodeEnv === "production") {
      return yield* new FakeEmailBackendInProduction({
        message:
          "EMAIL_BACKEND=fake cannot run with NODE_ENV=production: it accepts sends and never delivers them.",
      });
    }
    if (input.configured) {
      return input.configured;
    }
    return input.nodeEnv === "development" || input.nodeEnv === "test"
      ? ("fake" as const)
      : ("ses" as const);
  });

/**
 * The email Provider registry for a backend. The fake one answers every Provider row as
 * SES would and makes every Domain record look published, so Domain setup reaches neither
 * AWS nor public DNS.
 */
export const emailBackendLayer = (backend: EmailBackend) =>
  backend === "fake"
    ? Layer.mergeAll(
        Layer.unwrap(
          Effect.map(makeFakeSesProviderFactory, (factory) => EmailProviderRegistry.live(factory)),
        ),
        Layer.succeed(DnsLookups, {
          detectProvider: () => Promise.resolve("unknown"),
          evaluate: () => Promise.resolve({ matches: true, warnings: [] }),
        }),
      )
    : EmailProviderRegistry.live(awsSesProviderFactory);
