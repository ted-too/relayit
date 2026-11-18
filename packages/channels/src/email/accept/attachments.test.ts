import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Logger, References } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import {
  ATTACHMENTS_DEADLINE_SECONDS,
  MAX_ATTACHMENT_BYTES,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from "../attachment-policy";
import { PublicHostLookup } from "@repo/public-url";
import { resolveEmailAttachments } from "./attachments";

interface FetchCall {
  readonly init: BunFetchRequestInit;
  readonly url: string;
}

/** Outbound HTTP: records each request and answers it with `respond`, which may throw. */
const fakeFetch = (respond: (call: FetchCall) => Response | Promise<Response>) => {
  const calls: FetchCall[] = [];
  const fetch = Object.assign(
    (input: string | URL | Request, init?: BunFetchRequestInit) => {
      const call = { init: init ?? {}, url: String(input) };
      calls.push(call);
      return Promise.resolve().then(() => respond(call));
    },
    { preconnect: globalThis.fetch.preconnect },
  );
  return { calls, fetch };
};

/** DNS: the addresses each hostname resolves to. */
const fakeLookup = (answers: Record<string, readonly string[]>) => ({
  resolve: (hostname: string) => {
    const addresses = answers[hostname];
    return addresses === undefined
      ? Promise.reject(Object.assign(new Error("not found"), { code: "ENOTFOUND" }))
      : Promise.resolve(addresses);
  },
});

/** Every log line written while it is provided, with its annotations. */
const captureLogs = () => {
  const lines: { annotations: Record<string, unknown>; level: string; message: unknown }[] = [];
  const layer = Logger.layer([
    Logger.make((options) => {
      lines.push({
        annotations: options.fiber.getRef(References.CurrentLogAnnotations),
        level: options.logLevel,
        message: options.message,
      });
    }),
  ]);
  return { layer, lines };
};

const hosted = (url: string, filename = "file.pdf") => ({
  filename,
  source: { kind: "url" as const, url },
});

const resolveOne = (
  url: string,
  services: {
    readonly fetch: ReturnType<typeof fakeFetch>["fetch"];
    readonly lookup?: ReturnType<typeof fakeLookup>;
  },
) =>
  resolveEmailAttachments([hosted(url)], "org_test").pipe(
    Effect.provideService(FetchHttpClient.Fetch, services.fetch),
    Effect.provideService(PublicHostLookup, services.lookup ?? fakeLookup({})),
  );

describe("resolveEmailAttachments, hosted", () => {
  it.effect("refuses every scheme but https without fetching", () =>
    Effect.gen(function* () {
      const { calls, fetch } = fakeFetch(() => new Response("secret"));
      for (const url of [
        "file:///proc/self/environ",
        "http://files.example.com/a.pdf",
        "ftp://files.example.com/a.pdf",
        "data:text/plain,hello",
        "not a url",
      ]) {
        const error = yield* Effect.flip(resolveOne(url, { fetch }));
        expect(error).toMatchObject({
          _tag: "EmailAcceptRejected",
          code: "invalid_attachment",
          details: { filename: "file.pdf", reason: "unsupported_url" },
          message: "Attachment path must be an https URL.",
        });
      }
      expect(calls).toEqual([]);
    }),
  );

  it.effect("refuses a literal address that is not public, however it is spelled", () =>
    Effect.gen(function* () {
      const { calls, fetch } = fakeFetch(() => new Response("secret"));
      for (const url of [
        "https://127.0.0.1/a.pdf",
        "https://2130706433/a.pdf",
        "https://0x7f.1/a.pdf",
        "https://10.1.2.3/a.pdf",
        "https://172.16.0.1/a.pdf",
        "https://192.168.1.1/a.pdf",
        "https://169.254.169.254/latest/meta-data/",
        "https://100.64.0.1/a.pdf",
        "https://0.0.0.0/a.pdf",
        "https://[::]/a.pdf",
        "https://[::1]/a.pdf",
        "https://[::ffff:127.0.0.1]/a.pdf",
        "https://[::ffff:169.254.169.254]/a.pdf",
        "https://[::127.0.0.1]/a.pdf",
        "https://[fd00::1]/a.pdf",
        "https://[fe80::1]/a.pdf",
        "https://[64:ff9b::7f00:1]/a.pdf",
        "https://[2002:7f00:1::]/a.pdf",
      ]) {
        const error = yield* Effect.flip(resolveOne(url, { fetch }));
        expect(error, url).toMatchObject({
          code: "invalid_attachment",
          details: { reason: "blocked_address" },
          message: "Attachment URL's host has no public address.",
        });
      }
      expect(calls).toEqual([]);
    }),
  );

  it.effect("refuses a hostname when any address it resolves to is not public", () =>
    Effect.gen(function* () {
      const { calls, fetch } = fakeFetch(() => new Response("secret"));
      const lookup = fakeLookup({
        "internal.example.com": ["10.0.0.5"],
        "mapped.example.com": ["::ffff:10.0.0.5"],
        "mixed.example.com": ["93.184.215.14", "169.254.169.254"],
        "v6.example.com": ["fd12:3456::1"],
      });
      for (const host of ["internal", "mapped", "mixed", "v6"]) {
        const error = yield* Effect.flip(
          resolveOne(`https://${host}.example.com/a.pdf`, { fetch, lookup }),
        );
        expect(error, host).toMatchObject({ details: { reason: "blocked_address" } });
      }
      expect(calls).toEqual([]);
    }),
  );

  it.live("refuses a name the system resolver maps to loopback", () =>
    Effect.gen(function* () {
      const { calls, fetch } = fakeFetch(() => new Response("secret"));
      const error = yield* Effect.flip(
        resolveEmailAttachments([hosted("https://localhost/a.pdf")], "org_test").pipe(
          Effect.provideService(FetchHttpClient.Fetch, fetch),
        ),
      );
      expect(error).toMatchObject({ details: { reason: "blocked_address" } });
      expect(calls).toEqual([]);
    }),
  );

  it.effect("answers a name with no address as one with no public address", () =>
    Effect.gen(function* () {
      const { calls, fetch } = fakeFetch(() => new Response("file"));
      const lookup = fakeLookup({ "api.railway.internal": ["10.0.0.7"] });
      const logs = captureLogs();
      const missing = yield* Effect.flip(
        resolveOne("https://nowhere.railway.internal/a.pdf", { fetch, lookup }),
      ).pipe(Effect.provide(logs.layer));
      const internal = yield* Effect.flip(
        resolveOne("https://api.railway.internal/a.pdf", { fetch, lookup }),
      ).pipe(Effect.provide(logs.layer));
      // The customer can't tell an internal name that exists from one that doesn't.
      expect(missing).toEqual(internal);
      expect(missing).toMatchObject({
        code: "invalid_attachment",
        details: { filename: "file.pdf", reason: "blocked_address" },
      });
      expect(calls).toEqual([]);
      // Relayit's log can.
      expect(logs.lines.map((line) => line.annotations)).toMatchObject([
        { host: "nowhere.railway.internal", resolved: false },
        { host: "api.railway.internal", resolved: true },
      ]);
    }),
  );

  it.effect("refuses a hostname too long to exist without looking it up or logging it", () =>
    Effect.gen(function* () {
      const { calls, fetch } = fakeFetch(() => new Response("file"));
      const looked: string[] = [];
      const lookup = {
        resolve: (hostname: string) => {
          looked.push(hostname);
          return Promise.reject(Object.assign(new Error("not found"), { code: "ENOTFOUND" }));
        },
      };
      const logs = captureLogs();
      const label = "a".repeat(63);
      // The longest name DNS holds is looked up, and logged whole when it has no address.
      const longest = `${label}.${label}.${label}.${"a".repeat(61)}`;
      expect(longest).toHaveLength(253);
      const refused = yield* Effect.flip(
        resolveOne(`https://${longest}/a.pdf`, { fetch, lookup }),
      ).pipe(Effect.provide(logs.layer));
      expect(looked).toEqual([longest]);
      expect(logs.lines.map((line) => line.annotations)).toEqual([
        { host: longest, resolved: false },
      ]);

      // One character more, or the 60 KB a URL can carry, answers the same and reaches
      // neither the resolver nor the log.
      for (const hostname of [`a${longest}`, `${`${label}.`.repeat(1000)}test`]) {
        expect(
          yield* Effect.flip(resolveOne(`https://${hostname}/a.pdf`, { fetch, lookup })).pipe(
            Effect.provide(logs.layer),
          ),
        ).toEqual(refused);
      }
      expect(refused).toMatchObject({
        code: "invalid_attachment",
        details: { filename: "file.pdf", reason: "blocked_address" },
      });
      expect(looked).toEqual([longest]);
      expect(logs.lines).toHaveLength(1);
      expect(calls).toEqual([]);
    }),
  );

  it.effect("fetches from the address it resolved, naming the host and following no redirect", () =>
    Effect.gen(function* () {
      const { calls, fetch } = fakeFetch(
        () => new Response("%PDF", { headers: { "content-type": "application/pdf" } }),
      );
      const lookup = fakeLookup({
        "files.example.com": ["93.184.215.14"],
        "v6.example.com": ["2606:4700::6810:84e5"],
      });
      const [v4] = yield* resolveOne("https://files.example.com:8443/a.pdf?sig=1", {
        fetch,
        lookup,
      });
      const [v6] = yield* resolveOne("https://v6.example.com/a.pdf", { fetch, lookup });

      expect(v4).toMatchObject({ contentType: "application/pdf", filename: "file.pdf" });
      expect(new TextDecoder().decode(v4?.bytes)).toBe("%PDF");
      expect(v6?.bytes.byteLength).toBe(4);
      expect(calls).toMatchObject([
        {
          init: {
            headers: { host: "files.example.com:8443" },
            redirect: "manual",
            tls: { serverName: "files.example.com" },
          },
          url: "https://93.184.215.14:8443/a.pdf?sig=1",
        },
        {
          init: {
            headers: { host: "v6.example.com" },
            redirect: "manual",
            tls: { serverName: "v6.example.com" },
          },
          url: "https://[2606:4700::6810:84e5]/a.pdf",
        },
      ]);
    }),
  );

  it.effect("stops reading a body without a Content-Length once it passes the limit", () =>
    Effect.gen(function* () {
      const chunk = new Uint8Array(1024 * 1024);
      const total = MAX_ATTACHMENT_BYTES + 16 * chunk.byteLength;
      let pulled = 0;
      const { fetch } = fakeFetch(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull: (controller) => {
                if (pulled >= total) {
                  controller.close();
                  return;
                }
                pulled += chunk.byteLength;
                controller.enqueue(chunk);
              },
            }),
          ),
      );
      const lookup = fakeLookup({ "files.example.com": ["93.184.215.14"] });
      const error = yield* Effect.flip(
        resolveOne("https://files.example.com/large.bin", { fetch, lookup }).pipe(
          Effect.as("resolved"),
        ),
      );
      // The stream may have queued a chunk or two ahead; never the rest of the body.
      expect(pulled).toBeLessThan(MAX_ATTACHMENT_BYTES + 4 * chunk.byteLength);
      expect(error).toMatchObject({
        details: { maxBytes: MAX_ATTACHMENT_BYTES, reason: "exceeds_size_limit" },
      });
    }),
  );

  it.effect("times out a body that stops arriving after its headers", () =>
    Effect.gen(function* () {
      const { fetch } = fakeFetch(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              start: (controller) => controller.enqueue(new Uint8Array(10)),
            }),
          ),
      );
      const lookup = fakeLookup({ "files.example.com": ["93.184.215.14"] });
      const fiber = yield* resolveOne("https://files.example.com/slow.pdf", {
        fetch,
        lookup,
      }).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust("31 seconds");
      // A timeout that covered only the headers would leave it reading forever.
      const error = yield* Effect.raceFirst(
        Fiber.join(fiber),
        Effect.promise(() => Bun.sleep(1000)).pipe(Effect.as("still reading after the timeout")),
      );
      expect(error).toMatchObject({
        _tag: "EmailAcceptRejected",
        code: "invalid_attachment",
        details: { reason: "fetch_timeout" },
        message: "Attachments did not finish within the time limit.",
      });
    }),
  );

  it.live("fetches a few hosted attachments at a time", () =>
    Effect.gen(function* () {
      let inFlight = 0;
      let peak = 0;
      const { calls, fetch } = fakeFetch(async () => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await Bun.sleep(5);
        inFlight -= 1;
        return new Response("x");
      });
      const lookup = fakeLookup({ "files.example.com": ["93.184.215.14"] });
      const resolved = yield* resolveEmailAttachments(
        Array.from({ length: 20 }, (_, index) =>
          hosted(`https://files.example.com/${index}.pdf`, `${index}.pdf`),
        ),
        "org_test",
      ).pipe(
        Effect.provideService(FetchHttpClient.Fetch, fetch),
        Effect.provideService(PublicHostLookup, lookup),
      );
      expect(resolved).toHaveLength(20);
      expect(calls).toHaveLength(20);
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(4);
    }),
  );

  it.effect("refuses a redirect instead of following it", () =>
    Effect.gen(function* () {
      const { calls, fetch } = fakeFetch(
        () => new Response(null, { headers: { location: "https://127.0.0.1/" }, status: 302 }),
      );
      const lookup = fakeLookup({ "files.example.com": ["93.184.215.14"] });
      const error = yield* Effect.flip(
        resolveOne("https://files.example.com/a.pdf", { fetch, lookup }),
      );
      expect(error).toMatchObject({
        _tag: "EmailAcceptRejected",
        code: "invalid_attachment",
        details: { filename: "file.pdf", reason: "redirect_refused", status: 302 },
      });
      expect(calls).toMatchObject([{ init: { redirect: "manual" } }]);
    }),
  );

  it.effect("gives all of a send's attachments one deadline, not one each", () =>
    Effect.gen(function* () {
      // Each answers when the test says, so each takes as long as the test clock allows.
      const pending: (() => void)[] = [];
      const { calls, fetch } = fakeFetch(
        () =>
          new Promise<Response>((resolve) => {
            pending.push(() => resolve(new Response("%PDF")));
          }),
      );
      const lookup = fakeLookup({ "files.example.com": ["93.184.215.14"] });
      const settle = (count: number) =>
        Effect.promise(async () => {
          while (calls.length < count) {
            await Bun.sleep(1);
          }
        });
      const fiber = yield* resolveEmailAttachments(
        ["1", "2", "3", "4", "5"].map((name) =>
          hosted(`https://files.example.com/${name}.pdf`, `${name}.pdf`),
        ),
        "org_test",
      ).pipe(
        Effect.provideService(FetchHttpClient.Fetch, fetch),
        Effect.provideService(PublicHostLookup, lookup),
        Effect.flip,
        Effect.forkChild,
      );

      // Four at a time take 20 seconds; the fifth starts only then.
      yield* settle(4);
      yield* TestClock.adjust("20 seconds");
      for (const answer of pending.splice(0)) {
        answer();
      }
      yield* settle(5);
      // 35 seconds in: past the send's deadline, though the fifth has had only 15.
      yield* TestClock.adjust(`${ATTACHMENTS_DEADLINE_SECONDS - 15} seconds`);
      const error = yield* Effect.raceFirst(
        Fiber.join(fiber),
        Effect.promise(() => Bun.sleep(1000)).pipe(Effect.as("still fetching past the deadline")),
      );
      expect(error).toMatchObject({
        _tag: "EmailAcceptRejected",
        code: "invalid_attachment",
        details: { reason: "fetch_timeout" },
      });
    }),
  );

  it.effect("tries each checked address in turn until one connects", () =>
    Effect.gen(function* () {
      const refused = () => {
        throw Object.assign(new Error("connect failed"), { code: "ECONNREFUSED" });
      };
      const { calls, fetch } = fakeFetch(({ url }) =>
        url.includes("93.184.215.15") ? new Response("%PDF") : refused(),
      );
      const lookup = fakeLookup({
        "dead.example.com": ["93.184.215.13", "2606:4700::1"],
        "files.example.com": ["93.184.215.14", "93.184.215.15", "93.184.215.16"],
      });

      const [resolved] = yield* resolveOne("https://files.example.com/a.pdf", { fetch, lookup });
      expect(resolved?.bytes.byteLength).toBe(4);
      expect(calls.map((call) => call.url)).toEqual([
        "https://93.184.215.14/a.pdf",
        "https://93.184.215.15/a.pdf",
      ]);
      expect(calls[1]?.init).toMatchObject({ tls: { serverName: "files.example.com" } });

      // None connects: the customer's URL failed, not Relayit, but Relayit logs why, in
      // case the fault is its own, without the URL's signed query.
      const logs = captureLogs();
      const error = yield* Effect.flip(
        resolveOne("https://dead.example.com/a.pdf?sig=customer-secret", { fetch, lookup }),
      ).pipe(Effect.provide(logs.layer));
      expect(error).toEqual(
        expect.objectContaining({
          _tag: "EmailAcceptRejected",
          details: { filename: "file.pdf", reason: "fetch_failed" },
        }),
      );
      expect(calls).toHaveLength(4);
      expect(logs.lines).toMatchObject([
        {
          annotations: {
            code: "ECONNREFUSED",
            failure: "TransportError",
            host: "dead.example.com",
            name: "Error",
          },
          level: "Warn",
        },
      ]);
      expect(JSON.stringify(logs.lines)).not.toContain("customer-secret");
    }),
  );

  it.effect("stops at the first address that answers, whatever its status", () =>
    Effect.gen(function* () {
      const { calls, fetch } = fakeFetch(() => new Response("gone", { status: 404 }));
      const lookup = fakeLookup({ "files.example.com": ["93.184.215.14", "93.184.215.15"] });
      const error = yield* Effect.flip(
        resolveOne("https://files.example.com/a.pdf", { fetch, lookup }),
      );
      expect(error).toMatchObject({ details: { reason: "fetch_failed", status: 404 } });
      expect(calls).toHaveLength(1);
    }),
  );

  it.effect("refuses a body that breaks off, and takes a response without one as empty", () =>
    Effect.gen(function* () {
      const lookup = fakeLookup({ "files.example.com": ["93.184.215.14"] });
      const broken = fakeFetch(
        () =>
          new Response(
            new ReadableStream<Uint8Array>({
              pull: (controller) => {
                controller.enqueue(new Uint8Array(10));
                controller.error(new Error("connection reset"));
              },
            }),
          ),
      );
      const error = yield* Effect.flip(
        resolveOne("https://files.example.com/a.pdf", { fetch: broken.fetch, lookup }),
      );
      expect(error).toMatchObject({
        _tag: "EmailAcceptRejected",
        details: { filename: "file.pdf", reason: "fetch_failed" },
      });

      const empty = fakeFetch(() => new Response(null, { status: 204 }));
      const [resolved] = yield* resolveOne("https://files.example.com/a.pdf", {
        fetch: empty.fetch,
        lookup,
      });
      expect(resolved?.bytes.byteLength).toBe(0);
    }),
  );

  it.effect("times out a lookup that never answers", () =>
    Effect.gen(function* () {
      const { calls, fetch } = fakeFetch(() => new Response("file"));
      const fiber = yield* resolveOne("https://files.example.com/a.pdf", {
        fetch,
        lookup: { resolve: () => new Promise<readonly string[]>(() => undefined) },
      }).pipe(Effect.flip, Effect.forkChild);
      yield* TestClock.adjust("31 seconds");
      const error = yield* Effect.raceFirst(
        Fiber.join(fiber),
        Effect.promise(() => Bun.sleep(1000)).pipe(Effect.as("still resolving after the timeout")),
      );
      expect(error).toMatchObject({ details: { reason: "fetch_timeout" } });
      expect(calls).toEqual([]);
    }),
  );

  it.effect("keeps a DNS failure other than a missing name as Relayit's own", () =>
    Effect.gen(function* () {
      const { fetch } = fakeFetch(() => new Response("file"));
      const error = yield* Effect.flip(
        resolveOne("https://files.example.com/a.pdf", {
          fetch,
          lookup: {
            resolve: () =>
              Promise.reject(Object.assign(new Error("resolver down"), { code: "ECONNREFUSED" })),
          },
        }),
      );
      expect(error).toMatchObject({
        _tag: "EmailAcceptInfrastructureError",
        operation: "attachments",
      });
    }),
  );
});

/** `bytes` of varied content, as base64. */
const base64Of = (bytes: number) =>
  Buffer.from(new Uint8Array(bytes).map((_, index) => (index * 31 + 7) & 255)).toString("base64");

const inline = (content: string, filename = "file.pdf") => ({
  filename,
  source: { content, kind: "base64" as const },
});

describe("resolveEmailAttachments, inline and together", () => {
  it.effect("decodes valid base64 up to the limit, past where a regex over it gives up", () =>
    Effect.gen(function* () {
      // 6 MiB is 2^23 characters of base64, where Bun's regex engine stopped matching.
      for (const bytes of [6 * 1024 * 1024, MAX_ATTACHMENT_BYTES - 1]) {
        const [resolved] = yield* resolveEmailAttachments([inline(base64Of(bytes))], "org_test");
        expect(resolved?.bytes.byteLength).toBe(bytes);
        expect(resolved?.bytes[bytes - 1]).toBe(((bytes - 1) * 31 + 7) & 255);
      }
      const [wrapped] = yield* resolveEmailAttachments([inline("QUJD\nQQ==")], "org_test");
      expect(new TextDecoder().decode(wrapped?.bytes)).toBe("ABCA");
    }),
  );

  it.effect("refuses base64 that is malformed or decodes over the limit", () =>
    Effect.gen(function* () {
      for (const content of ["QQ", "QQ=", "Q===", "QQ=A", "QQ==QQ==", "QU-D", "QU_D", "!!!!"]) {
        const error = yield* Effect.flip(resolveEmailAttachments([inline(content)], "org_test"));
        expect(error, content).toMatchObject({ details: { reason: "invalid_base64" } });
      }
      const error = yield* Effect.flip(
        resolveEmailAttachments([inline(base64Of(MAX_ATTACHMENT_BYTES + 1))], "org_test").pipe(
          Effect.as("resolved"),
        ),
      );
      expect(error).toMatchObject({
        details: { maxBytes: MAX_ATTACHMENT_BYTES, reason: "exceeds_size_limit" },
      });
    }),
  );

  it.effect("refuses inline attachments that together pass what SES can carry", () =>
    Effect.gen(function* () {
      const nine = base64Of(9 * 1024 * 1024);
      const underTotal = resolveEmailAttachments(
        [inline(nine, "1.pdf"), inline(nine, "2.pdf"), inline(nine, "3.pdf")],
        "org_test",
      );
      // Each run counts afresh: a retried accept is not refused for the first attempt.
      for (const _ of [1, 2]) {
        const [first] = yield* underTotal;
        expect(first?.bytes.byteLength).toBe(9 * 1024 * 1024);
      }

      const error = yield* Effect.flip(
        resolveEmailAttachments(
          ["1", "2", "3", "4"].map((name) => inline(nine, `${name}.pdf`)),
          "org_test",
        ).pipe(Effect.as("resolved")),
      );
      expect(error).toMatchObject({
        _tag: "EmailAcceptRejected",
        code: "invalid_attachment",
        details: { maxBytes: MAX_TOTAL_ATTACHMENT_BYTES, reason: "exceeds_total_size_limit" },
        message: "Attachments together exceed the size limit.",
      });
    }),
  );

  it.live("stops every download once the send's total passes the limit", () =>
    Effect.gen(function* () {
      const chunk = new Uint8Array(256 * 1024);
      const each = 9 * 1024 * 1024;
      let pulled = 0;
      let canceled = 0;
      const { fetch } = fakeFetch(() => {
        let sent = 0;
        return new Response(
          new ReadableStream<Uint8Array>({
            cancel: () => {
              canceled += 1;
            },
            pull: async (controller) => {
              await Bun.sleep(1);
              if (sent >= each) {
                controller.close();
                return;
              }
              sent += chunk.byteLength;
              pulled += chunk.byteLength;
              controller.enqueue(chunk);
            },
          }),
        );
      });
      const lookup = fakeLookup({ "files.example.com": ["93.184.215.14"] });
      // One inline and three hosted of 9 MiB: 36 MiB together.
      const error = yield* Effect.flip(
        resolveEmailAttachments(
          [
            inline(base64Of(each), "inline.pdf"),
            ...["1", "2", "3"].map((name) =>
              hosted(`https://files.example.com/${name}.pdf`, `${name}.pdf`),
            ),
          ],
          "org_test",
        ).pipe(
          Effect.as("resolved"),
          Effect.provideService(FetchHttpClient.Fetch, fetch),
          Effect.provideService(PublicHostLookup, lookup),
        ),
      );
      expect(error).toMatchObject({ details: { reason: "exceeds_total_size_limit" } });
      // Downloads stopped near the limit, a few queued chunks aside, not at 27 MiB.
      expect(each + pulled).toBeLessThan(MAX_TOTAL_ATTACHMENT_BYTES + 16 * chunk.byteLength);
      expect(canceled).toBeGreaterThan(0);
    }),
  );
});
