import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { emailBackendConfig, selectEmailBackend } from "./backend";

const select = (configured: "fake" | "ses" | undefined, nodeEnv: string | undefined) =>
  Effect.runPromise(selectEmailBackend({ configured, nodeEnv }).pipe(Effect.result));

describe("selectEmailBackend", () => {
  test("keeps SES when nothing is set, as a deployed image without NODE_ENV runs", async () => {
    expect(await select(undefined, undefined)).toMatchObject({ success: "ses" });
    expect(await select(undefined, "production")).toMatchObject({ success: "ses" });
  });

  test("defaults to the fake under development and test", async () => {
    expect(await select(undefined, "development")).toMatchObject({ success: "fake" });
    expect(await select(undefined, "test")).toMatchObject({ success: "fake" });
  });

  test("follows EMAIL_BACKEND when set", async () => {
    expect(await select("ses", "development")).toMatchObject({ success: "ses" });
    expect(await select("fake", undefined)).toMatchObject({ success: "fake" });
  });

  test("refuses the fake under NODE_ENV=production", async () => {
    expect(await select("fake", "production")).toMatchObject({
      failure: { _tag: "FakeEmailBackendInProduction" },
    });
  });
});

const config = (input: Partial<Parameters<typeof emailBackendConfig>[0]>) =>
  Effect.runPromise(
    emailBackendConfig({
      accessKeyId: undefined,
      kind: "ses",
      regions: undefined,
      secretAccessKey: undefined,
      ...input,
    }).pipe(Effect.result),
  );

describe("emailBackendConfig", () => {
  test("needs no SES variable for the fake", async () => {
    expect(await config({ kind: "fake" })).toMatchObject({
      success: { defaultRegion: "fake", kind: "fake" },
    });
  });

  test("reads SES_REGIONS in order, the first the default, without repeats", async () => {
    expect(
      await config({
        accessKeyId: "AKIA",
        regions: " eu-central-1, us-east-1,eu-central-1 ",
        secretAccessKey: "secret",
      }),
    ).toMatchObject({
      success: { kind: "ses", ses: { regions: ["eu-central-1", "us-east-1"] } },
    });
  });

  test("refuses SES without its regions or keys", async () => {
    expect(await config({ accessKeyId: "AKIA", secretAccessKey: "secret" })).toMatchObject({
      failure: { _tag: "SesConfigInvalid", variable: "SES_REGIONS" },
    });
    expect(await config({ regions: "eu-central-1", secretAccessKey: "secret" })).toMatchObject({
      failure: { variable: "SES_ACCESS_KEY_ID" },
    });
    expect(await config({ accessKeyId: "AKIA", regions: "eu-central-1" })).toMatchObject({
      failure: { variable: "SES_SECRET_ACCESS_KEY" },
    });
  });

  test("refuses a region that is not an AWS region name", async () => {
    expect(await config({ kind: "fake", regions: "eu-central-1,Frankfurt" })).toMatchObject({
      failure: { variable: "SES_REGIONS" },
    });
  });
});
