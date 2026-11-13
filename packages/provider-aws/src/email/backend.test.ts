import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { emailBackendConfig, selectEmailBackend } from "./backend";

const select = (configured: "fake" | "ses" | undefined, nodeEnv: string | undefined) =>
  selectEmailBackend({ configured, nodeEnv }).pipe(Effect.result);

describe("selectEmailBackend", () => {
  it.effect("keeps SES when nothing is set, as a deployed image without NODE_ENV runs", () =>
    Effect.gen(function* () {
      expect(yield* select(undefined, undefined)).toMatchObject({ success: "ses" });
      expect(yield* select(undefined, "production")).toMatchObject({ success: "ses" });
    }),
  );

  it.effect("defaults to the fake under development and test", () =>
    Effect.gen(function* () {
      expect(yield* select(undefined, "development")).toMatchObject({ success: "fake" });
      expect(yield* select(undefined, "test")).toMatchObject({ success: "fake" });
    }),
  );

  it.effect("follows EMAIL_BACKEND when set", () =>
    Effect.gen(function* () {
      expect(yield* select("ses", "development")).toMatchObject({ success: "ses" });
      expect(yield* select("fake", undefined)).toMatchObject({ success: "fake" });
    }),
  );

  it.effect("refuses the fake under NODE_ENV=production", () =>
    Effect.gen(function* () {
      expect(yield* select("fake", "production")).toMatchObject({
        failure: { _tag: "FakeEmailBackendInProduction" },
      });
    }),
  );
});

const config = (input: Partial<Parameters<typeof emailBackendConfig>[0]>) =>
  emailBackendConfig({
    accessKeyId: undefined,
    kind: "ses",
    regions: undefined,
    secretAccessKey: undefined,
    ...input,
  }).pipe(Effect.result);

describe("emailBackendConfig", () => {
  it.effect("needs no SES variable for the fake", () =>
    Effect.gen(function* () {
      expect(yield* config({ kind: "fake" })).toMatchObject({
        success: { defaultRegion: "fake", kind: "fake" },
      });
    }),
  );

  it.effect("reads SES_REGIONS in order, the first the default, without repeats", () =>
    Effect.gen(function* () {
      expect(
        yield* config({
          accessKeyId: "AKIA",
          regions: " eu-central-1, us-east-1,eu-central-1 ",
          secretAccessKey: "secret",
        }),
      ).toMatchObject({
        success: { kind: "ses", ses: { regions: ["eu-central-1", "us-east-1"] } },
      });
    }),
  );

  it.effect("refuses SES without its regions or keys", () =>
    Effect.gen(function* () {
      expect(yield* config({ accessKeyId: "AKIA", secretAccessKey: "secret" })).toMatchObject({
        failure: { _tag: "SesConfigInvalid", variable: "SES_REGIONS" },
      });
      expect(yield* config({ regions: "eu-central-1", secretAccessKey: "secret" })).toMatchObject({
        failure: { variable: "SES_ACCESS_KEY_ID" },
      });
      expect(yield* config({ accessKeyId: "AKIA", regions: "eu-central-1" })).toMatchObject({
        failure: { variable: "SES_SECRET_ACCESS_KEY" },
      });
    }),
  );

  it.effect("refuses a region that is not an AWS region name", () =>
    Effect.gen(function* () {
      expect(yield* config({ kind: "fake", regions: "eu-central-1,Frankfurt" })).toMatchObject({
        failure: { variable: "SES_REGIONS" },
      });
    }),
  );
});
