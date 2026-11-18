import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { selectEmailBackend } from "./backend";

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
