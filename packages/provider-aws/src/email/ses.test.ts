import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { makeSesEmailBackend, provesNotSent } from "./ses";

const SEND_PATH = "/v2/email/outbound-emails";

/** One send through the real SES client, with SES at `endpoint`. */
const sendThrough = (endpoint: string) =>
  Effect.gen(function* () {
    const previous = process.env.AWS_ENDPOINT_URL_SESV2;
    process.env.AWS_ENDPOINT_URL_SESV2 = endpoint;
    return yield* Effect.gen(function* () {
      const backend = yield* makeSesEmailBackend({
        accessKeyId: "AKIATEST",
        regions: ["eu-central-1"],
        secretAccessKey: "secret",
      });
      return yield* backend
        .send({
          message: {
            bcc: null,
            cc: null,
            from: { address: "hello@example.com", normalized: "hello@example.com" },
            headers: null,
            html: null,
            replyTo: null,
            sender: { identityFqdn: "example.com", projectId: "orgn_test" },
            subject: "Hello",
            text: "Hello",
            to: ["someone@example.com"],
          },
          region: "eu-central-1",
        })
        .pipe(Effect.flip);
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          if (previous === undefined) {
            delete process.env.AWS_ENDPOINT_URL_SESV2;
          } else {
            process.env.AWS_ENDPOINT_URL_SESV2 = previous;
          }
        }),
      ),
    );
  });

/** SES, the boundary: answers every call with `status`, counting the sends. */
const answering = (status: number, errorType: string) => {
  const sends: string[] = [];
  const server = Bun.serve({
    fetch: (request) => {
      const path = new URL(request.url).pathname;
      if (path === SEND_PATH) {
        sends.push(path);
      }
      return new Response(JSON.stringify({ message: "Refused" }), {
        headers: { "content-type": "application/json", "x-amzn-errortype": errorType },
        status,
      });
    },
    port: 0,
  });
  return { sends, stop: Effect.sync(() => void server.stop(true)), url: server.url.origin };
};

describe("the SES backend's send", () => {
  it.live("goes to SES once, as an unknown outcome, when SES answers with a 5xx", () => {
    const ses = answering(500, "InternalFailure");
    return Effect.gen(function* () {
      const error = yield* sendThrough(ses.url);

      expect(error).toMatchObject({ _tag: "EmailBackendUnavailable" });
      // The SDK would try a 5xx three times; the delivery job decides instead.
      expect(ses.sends).toHaveLength(1);
    }).pipe(Effect.ensuring(ses.stop));
  });

  it.live("is refused when SES answers with a 4xx it does not model", () => {
    const ses = answering(403, "UnrecognizedClientException");
    return Effect.gen(function* () {
      expect(yield* sendThrough(ses.url)).toMatchObject({
        _tag: "EmailBackendRejected",
        reason: "not_sent",
      });
    }).pipe(Effect.ensuring(ses.stop));
  });

  it.live("is refused when the connection to SES cannot be made", () =>
    Effect.gen(function* () {
      const closed = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: () => {} } });
      const port = closed.port;
      closed.stop(true);

      expect(yield* sendThrough(`http://127.0.0.1:${port}`)).toMatchObject({
        _tag: "EmailBackendRejected",
        reason: "not_sent",
      });
    }),
  );

  it.live("is refused when SES's host cannot be resolved", () =>
    Effect.gen(function* () {
      // `.invalid` never resolves, so the request never leaves.
      expect(yield* sendThrough("http://relayit-ses-test.invalid")).toMatchObject({
        _tag: "EmailBackendRejected",
        reason: "not_sent",
      });
    }),
  );

  it.live("goes to SES once, as an unknown outcome, when the connection drops after it", () => {
    // SES takes the request and the connection is reset before any answer.
    const sends: string[] = [];
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data: (socket, chunk) => {
          if (Buffer.from(chunk).toString("latin1").includes(SEND_PATH)) {
            sends.push(SEND_PATH);
          }
          socket.terminate();
        },
      },
    });
    return Effect.gen(function* () {
      const error = yield* sendThrough(`http://127.0.0.1:${server.port}`);

      expect(error).toMatchObject({ _tag: "EmailBackendUnavailable" });
      expect(sends).toHaveLength(1);
    }).pipe(Effect.ensuring(Effect.sync(() => server.stop(true))));
  });
});

/**
 * Failures a local SES cannot be made to produce, shaped as the SDK reports them: its
 * `SdkError` carries the Node error's `code` and `syscall`.
 */
describe("which send failures prove SES never took the message", () => {
  it("counts a refused connection, a failed lookup or a 4xx as not sent", () => {
    expect(provesNotSent({ code: "ECONNREFUSED", syscall: "connect" })).toBe(true);
    expect(provesNotSent({ code: "ENOTFOUND", syscall: "getaddrinfo" })).toBe(true);
    expect(provesNotSent({ code: "EHOSTUNREACH", syscall: "connect" })).toBe(true);
    expect(provesNotSent({ $metadata: { httpStatusCode: 403 } })).toBe(true);
    expect(provesNotSent({ code: "DEPTH_ZERO_SELF_SIGNED_CERT" })).toBe(true);
  });

  it("counts a network error after the request went out as an unknown outcome", () => {
    expect(provesNotSent({ code: "EHOSTUNREACH", syscall: "read" })).toBe(false);
    expect(provesNotSent({ code: "ENETUNREACH", syscall: "write" })).toBe(false);
    expect(provesNotSent({ code: "ECONNRESET", syscall: "read" })).toBe(false);
  });

  it("counts a TLS error mid-connection as an unknown outcome", () => {
    expect(provesNotSent({ code: "ERR_SSL_DECRYPTION_FAILED_OR_BAD_RECORD_MAC" })).toBe(false);
    // A record with the wrong version can arrive after the handshake, once SES has the request.
    expect(provesNotSent({ code: "ERR_SSL_WRONG_VERSION_NUMBER" })).toBe(false);
  });

  it("counts a 5xx as an unknown outcome", () => {
    expect(provesNotSent({ $metadata: { httpStatusCode: 503 } })).toBe(false);
  });
});
