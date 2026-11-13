import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { request, serve, stubs } from "./testing";

describe("/openapi.json", () => {
  it.live("documents the public routes only, not the dashboard's or better-auth's", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);
      const document = JSON.parse((yield* request(origin, "GET", "/openapi.json")).body) as {
        readonly paths: Record<string, unknown>;
      };
      expect(Object.keys(document.paths).sort()).toEqual([
        "/messages/email",
        "/send/{project}/raw/email",
        "/send/{project}/template/email",
      ]);
    }),
  );
});
