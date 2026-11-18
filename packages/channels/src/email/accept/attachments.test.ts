import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { MAX_ATTACHMENT_BYTES } from "../attachment-policy";
import { AttachmentHostLookup, resolveEmailAttachments } from "./attachments";

interface FetchCall {
  readonly init: BunFetchRequestInit;
  readonly url: string;
}

/** Outbound HTTP: records each request and answers it with `respond`. */
const fakeFetch = (respond: (call: FetchCall) => Response | Promise<Response>) => {
  const calls: FetchCall[] = [];
  const fetch = Object.assign(
    (input: string | URL | Request, init?: BunFetchRequestInit) => {
      const call = { init: init ?? {}, url: String(input) };
      calls.push(call);
      return Promise.resolve(respond(call));
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
    Effect.provideService(AttachmentHostLookup, services.lookup ?? fakeLookup({})),
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
          message: "Attachment URL must resolve to a public address.",
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

  it.effect("refuses a hostname that does not resolve", () =>
    Effect.gen(function* () {
      const { fetch } = fakeFetch(() => new Response("file"));
      const error = yield* Effect.flip(resolveOne("https://nowhere.example.com/a.pdf", { fetch }));
      expect(error).toMatchObject({
        code: "invalid_attachment",
        details: { reason: "unresolvable_host" },
      });
    }),
  );

  it.effect("fetches from the address it resolved, naming the host and refusing redirects", () =>
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
            redirect: "error",
            tls: { serverName: "files.example.com" },
          },
          url: "https://93.184.215.14:8443/a.pdf?sig=1",
        },
        {
          init: {
            headers: { host: "v6.example.com" },
            redirect: "error",
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
        _tag: "EmailAcceptInfrastructureError",
        cause: { _tag: "TimeoutError" },
        operation: "attachments",
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
        Effect.provideService(AttachmentHostLookup, lookup),
      );
      expect(resolved).toHaveLength(20);
      expect(calls).toHaveLength(20);
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(4);
    }),
  );
});
