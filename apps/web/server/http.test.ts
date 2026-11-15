import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import { afterAll, describe, expect, it } from "@effect/vitest";
import { RESERVED_PROJECT_SLUGS } from "@repo/contracts/dashboard";
import { Context, Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { webServer } from "./http";

const dist = NodeFS.mkdtempSync(NodePath.join(NodeOS.tmpdir(), "relayit-web-"));
NodeFS.mkdirSync(NodePath.join(dist, "assets"));
NodeFS.writeFileSync(NodePath.join(dist, "index.html"), "<!doctype html><title>Relayit</title>");
NodeFS.writeFileSync(NodePath.join(dist, "assets", "index-AbC123xy.js"), "console.log(1)");
NodeFS.writeFileSync(NodePath.join(dist, "favicon.svg"), "<svg/>");
afterAll(() => NodeFS.rmSync(dist, { force: true, recursive: true }));

const HTML = { accept: "text/html,application/xhtml+xml" };

/** The server as the image runs it, with the api at `apiUrl`, on a free port. */
const serve = (apiUrl: string) =>
  Effect.gen(function* () {
    const services = yield* Layer.build(
      webServer({ apiUrl: new URL(apiUrl), hostname: "127.0.0.1", port: 0, root: dist }),
    );
    const { address } = Context.get(services, HttpServer.HttpServer);
    if (address._tag === "UnixPathAddress") {
      return yield* Effect.die("the server listens on TCP");
    }
    return `http://127.0.0.1:${address.port}`;
  });

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

describe("the dashboard's server", () => {
  it.live("tells the page the api's origin from API_URL, uncached", () =>
    Effect.gen(function* () {
      for (const apiUrl of ["https://api.example.com", "http://localhost:3105/"]) {
        const origin = yield* serve(apiUrl);
        expect(yield* get(origin, "/config.js")).toEqual({
          body: `window.RELAYIT_CONFIG = {"apiUrl":"${new URL(apiUrl).origin}"};\n`,
          cacheControl: "no-cache",
          contentType: "text/javascript; charset=utf-8",
          frameOptions: "DENY",
          status: 200,
        });
      }
    }),
  );

  it.live("answers a browser's page load anywhere in the dashboard with index.html", () =>
    Effect.gen(function* () {
      const origin = yield* serve("https://api.example.com");
      for (const path of [
        "/",
        "/local/domains",
        "/auth/sign-in?redirect=%2F",
        "/local/domains/mail.example.com",
        "/unsubscribe/acme/c?msg=m&topic=t&sig=s",
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

  it.live("caches hashed assets for good, and 404s what isn't there", () =>
    Effect.gen(function* () {
      const origin = yield* serve("https://api.example.com");
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
      // A script or an API call isn't a page load.
      expect(yield* get(origin, "/assets/missing-0000000.js")).toMatchObject({ status: 404 });
      expect(yield* get(origin, "/local/domains", { accept: "application/json" })).toMatchObject({
        status: 404,
      });
    }),
  );

  // A Project's dashboard URL is `/<slug>`, and the server answers a root file first.
  it("serves no root file a Project's slug could take", () => {
    const publicDir = NodePath.join(import.meta.dirname, "..", "public");
    for (const name of [...NodeFS.readdirSync(publicDir), "config.js", "assets"]) {
      expect(RESERVED_PROJECT_SLUGS.has(name), name).toBe(true);
    }
  });
});
