import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { GOOD_KEY, serve, stubs } from "../testing";

const dist = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "relayit-dashboard-"));
NodeFS.mkdirSync(NodePath.join(dist, "assets"));
NodeFS.writeFileSync(NodePath.join(dist, "index.html"), "<!doctype html><title>Relayit</title>");
NodeFS.writeFileSync(NodePath.join(dist, "assets", "index-AbC123xy.js"), "console.log(1)");
NodeFS.writeFileSync(NodePath.join(dist, "favicon.svg"), "<svg/>");
afterAll(() => NodeFS.rmSync(dist, { force: true, recursive: true }));

const HTML = { accept: "text/html,application/xhtml+xml" };

const get = (origin: string, path: string, headers: Record<string, string> = {}) =>
  Effect.promise(async () => {
    const response = await fetch(`${origin}${path}`, { headers });
    return {
      body: await response.text(),
      cacheControl: response.headers.get("cache-control"),
      contentType: response.headers.get("content-type"),
      frameOptions: response.headers.get("x-frame-options"),
      status: response.status,
    };
  });

const notFound = { body: "NOT_FOUND", contentType: "text/plain;charset=utf-8", status: 404 };

describe("the dashboard's build, served by the api", () => {
  it.live("answers a browser's page load anywhere in the dashboard with index.html", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs({ dashboardDir: dist }).stubs);
      for (const path of [
        "/",
        "/local/domains",
        "/auth/sign-in?redirect=%2F",
        "/local/domains/mail.example.com",
        "/unsubscribe/acme/c",
      ]) {
        expect(yield* get(origin, path, HTML)).toEqual({
          body: "<!doctype html><title>Relayit</title>",
          cacheControl: "no-cache",
          contentType: "text/html; charset=utf-8",
          frameOptions: "DENY",
          status: 200,
        });
      }
    }),
  );

  it.live("caches hashed assets for good and serves other files as they are", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs({ dashboardDir: dist }).stubs);
      expect(yield* get(origin, "/assets/index-AbC123xy.js")).toMatchObject({
        body: "console.log(1)",
        cacheControl: "public, max-age=31536000, immutable",
        status: 200,
      });
      expect(yield* get(origin, "/favicon.svg")).toMatchObject({
        cacheControl: "no-cache",
        contentType: "image/svg+xml; charset=utf-8",
        status: 200,
      });
    }),
  );

  it.live("keeps the api's 404 for unknown paths that aren't a browser's page load", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs({ dashboardDir: dist }).stubs);
      // Not HTML, or a file that isn't there.
      expect(yield* get(origin, "/nope")).toMatchObject(notFound);
      expect(yield* get(origin, "/assets/missing-0000000.js")).toMatchObject(notFound);
      expect(yield* get(origin, "/local/domains", { accept: "application/json" })).toMatchObject(
        notFound,
      );
      // The api's own paths, even from a browser.
      for (const path of [
        "/messages/email",
        "/send/acme/raw/email",
        "/webhooks/providers/aws/ses",
        "/api/dashboard/nope",
        "/api/nope",
        "/health/nope",
      ]) {
        expect(yield* get(origin, path, { ...HTML, "x-api-key": GOOD_KEY })).toMatchObject(
          notFound,
        );
      }
      expect(yield* get(origin, "/health", HTML)).toMatchObject({ status: 200 });
    }),
  );

  it.live("leaves a POST to an unknown path to the api", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs({ dashboardDir: dist }).stubs);
      const response = yield* Effect.promise(() =>
        fetch(`${origin}/local/domains`, { headers: HTML, method: "POST" }),
      );
      expect(response.status).toBe(404);
      expect(yield* Effect.promise(() => response.text())).toBe("NOT_FOUND");
    }),
  );
});
