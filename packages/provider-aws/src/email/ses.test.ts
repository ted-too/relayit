import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { EmailBackendService } from "@repo/channels/email/backend";
import { makeSesEmailBackend, provesNotSent } from "./ses";

const SEND_PATH = "/v2/email/outbound-emails";

/** Runs `use` with the real SES client, with SES at `endpoint`. */
const withSesAt = <A, E>(
  endpoint: string,
  use: (backend: EmailBackendService) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const previous = process.env.AWS_ENDPOINT_URL_SESV2;
    process.env.AWS_ENDPOINT_URL_SESV2 = endpoint;
    return yield* makeSesEmailBackend({
      accessKeyId: "AKIATEST",
      regions: ["eu-central-1"],
      secretAccessKey: "secret",
    }).pipe(
      Effect.flatMap(use),
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

/** Runs `use` with one send through the real SES client, with SES at `endpoint`. */
const throughSes = <A, E>(
  endpoint: string,
  use: (send: ReturnType<EmailBackendService["send"]>) => Effect.Effect<A, E>,
) =>
  withSesAt(endpoint, (backend) =>
    use(
      backend.send({
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
      }),
    ),
  );

/** What one send that SES does not accept fails with. */
const sendThrough = (endpoint: string) => throughSes(endpoint, Effect.flip);

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

  it.live("opens a connection of its own for every send, however alive the last one is", () => {
    // SES accepts every send and offers to keep each connection open.
    const sendsOnConnection: number[] = [];
    const server = Bun.listen<{ connection: number }>({
      hostname: "127.0.0.1",
      port: 0,
      socket: {
        data: (socket, chunk) => {
          if (Buffer.from(chunk).toString("latin1").includes(SEND_PATH)) {
            sendsOnConnection[socket.data.connection] =
              (sendsOnConnection[socket.data.connection] ?? 0) + 1;
          }
          const body = JSON.stringify({ MessageId: "ses-message-id" });
          socket.write(
            `HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: ${body.length}\r\nconnection: keep-alive\r\n\r\n${body}`,
          );
        },
        open: (socket) => {
          socket.data = { connection: sendsOnConnection.length };
          sendsOnConnection.push(0);
        },
      },
    });
    return Effect.gen(function* () {
      const sent = yield* throughSes(`http://127.0.0.1:${server.port}`, (send) =>
        Effect.forEach([1, 2, 3], () => send),
      );

      expect(sent).toEqual([
        { providerMessageId: "ses-message-id" },
        { providerMessageId: "ses-message-id" },
        { providerMessageId: "ses-message-id" },
      ]);
      // The tenant calls beside each send keep their own kept-alive connection.
      expect(sendsOnConnection.filter((sends) => sends > 0)).toEqual([1, 1, 1]);
    }).pipe(Effect.ensuring(Effect.sync(() => server.stop(true))));
  });

  it.live("is an unknown outcome when a connection SES accepted drops before it reads", () => {
    // Bun names the failing syscall `connect` only when no connection was made. One that
    // was made and then dropped, even with nothing of the request read, must not be taken
    // for proof that nothing was sent.
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data: () => {}, open: (socket) => void socket.terminate() },
    });
    return Effect.gen(function* () {
      const error = yield* sendThrough(`http://127.0.0.1:${server.port}`);

      expect(error).toMatchObject({ _tag: "EmailBackendUnavailable" });
      expect(provesNotSent(error.cause)).toBe(false);
      expect(error.cause).not.toMatchObject({ syscall: "connect" });
    }).pipe(Effect.ensuring(Effect.sync(() => server.stop(true))));
  });

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

describe("the SES backend's read of a Project's sending status", () => {
  const statusThrough = (endpoint: string) =>
    withSesAt(endpoint, (backend) =>
      Effect.flip(
        backend.getProjectSendingStatus({ projectId: "orgn_test", region: "eu-central-1" }),
      ),
    );

  it.live("fails as credentials, not as SES being down, when SES denies the read", () => {
    // What SES answers an IAM user without ses:GetTenant: a 403 it has no modelled error for.
    const ses = answering(403, "AccessDeniedException");
    return Effect.gen(function* () {
      expect(yield* statusThrough(ses.url)).toMatchObject({
        _tag: "EmailBackendAuthenticationError",
        region: "eu-central-1",
      });
    }).pipe(Effect.ensuring(ses.stop));
  });

  it.live("fails as unavailable, to be retried, when SES answers with a 5xx", () => {
    const ses = answering(500, "InternalFailure");
    return Effect.gen(function* () {
      expect(yield* statusThrough(ses.url)).toMatchObject({ _tag: "EmailBackendUnavailable" });
    }).pipe(Effect.ensuring(ses.stop));
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
