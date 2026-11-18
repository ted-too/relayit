import { EmailBackend } from "@repo/channels/email/backend";
import { DnsLookups } from "@repo/channels/email/dns-lookups";
import { Data, Effect, Layer } from "effect";
import { makeFakeEmailBackend } from "./fake";
import { makeSesEmailBackend, type SesConfig } from "./ses";

/** What email goes through: SES, or the local stand-in in `./fake.ts`. */
export type EmailBackendKind = "fake" | "ses";

export class FakeEmailBackendInProduction extends Data.TaggedError("FakeEmailBackendInProduction")<{
  readonly message: string;
}> {}

export class SesConfigInvalid extends Data.TaggedError("SesConfigInvalid")<{
  readonly message: string;
  readonly variable: "SES_ACCESS_KEY_ID" | "SES_REGIONS" | "SES_SECRET_ACCESS_KEY";
}> {}

/**
 * `EMAIL_BACKEND` when set. Otherwise fake only when NODE_ENV says development or test:
 * the api, worker and builder images don't set NODE_ENV, so an unset one must keep meaning SES.
 */
export const selectEmailBackend = (input: {
  readonly configured: EmailBackendKind | undefined;
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

const REGION = /^[a-z]{2}(-[a-z]+)+-\d+$/;

/** What the fake records as a new Domain's region when `SES_REGIONS` is unset. */
const FAKE_REGION = "fake";

export type EmailBackendConfig =
  | { readonly defaultRegion: string; readonly kind: "fake" }
  | { readonly kind: "ses"; readonly ses: SesConfig };

/**
 * The backend's settings from the environment. SES needs `SES_ACCESS_KEY_ID`,
 * `SES_SECRET_ACCESS_KEY` and `SES_REGIONS` (comma-separated, the first where new Domains
 * are registered); the fake needs none of them.
 */
export const emailBackendConfig = (input: {
  readonly accessKeyId: string | undefined;
  readonly kind: EmailBackendKind;
  readonly regions: string | undefined;
  readonly secretAccessKey: string | undefined;
}) =>
  Effect.gen(function* () {
    const regions = (input.regions ?? "")
      .split(",")
      .map((region) => region.trim())
      .filter((region) => region.length > 0);
    const invalid = regions.find((region) => !REGION.test(region));
    if (invalid !== undefined) {
      return yield* new SesConfigInvalid({
        message: "SES_REGIONS must be a comma-separated list of AWS region names.",
        variable: "SES_REGIONS",
      });
    }
    const [defaultRegion, ...otherRegions] = new Set(regions);

    if (input.kind === "fake") {
      return { defaultRegion: defaultRegion ?? FAKE_REGION, kind: "fake" } as const;
    }
    if (defaultRegion === undefined) {
      return yield* new SesConfigInvalid({
        message: "EMAIL_BACKEND=ses needs SES_REGIONS: the SES regions to send through.",
        variable: "SES_REGIONS",
      });
    }
    if (!input.accessKeyId) {
      return yield* new SesConfigInvalid({
        message: "EMAIL_BACKEND=ses needs SES_ACCESS_KEY_ID.",
        variable: "SES_ACCESS_KEY_ID",
      });
    }
    if (!input.secretAccessKey) {
      return yield* new SesConfigInvalid({
        message: "EMAIL_BACKEND=ses needs SES_SECRET_ACCESS_KEY.",
        variable: "SES_SECRET_ACCESS_KEY",
      });
    }
    return {
      kind: "ses",
      ses: {
        accessKeyId: input.accessKeyId,
        regions: [defaultRegion, ...otherRegions],
        secretAccessKey: input.secretAccessKey,
      },
    } as const;
  });

/**
 * The email backend for its config. The fake also makes every Domain record look
 * published, so Domain setup reaches neither AWS nor public DNS.
 */
export const emailBackendLayer = (config: EmailBackendConfig) =>
  config.kind === "fake"
    ? Layer.mergeAll(
        Layer.effect(EmailBackend, makeFakeEmailBackend(config.defaultRegion)),
        Layer.succeed(DnsLookups, {
          detectProvider: () => Promise.resolve("unknown"),
          evaluate: () => Promise.resolve({ matches: true, warnings: [] }),
        }),
      )
    : Layer.effect(EmailBackend, makeSesEmailBackend(config.ses));
