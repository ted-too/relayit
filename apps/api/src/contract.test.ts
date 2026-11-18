/**
 * The api's HTTP contract: requests in, exact status, content type and body out, over a
 * real Bun server with the boundaries stubbed (`testing.ts`). `/messages/email` and the
 * legacy `/send/*` are customer contracts, and SNS posts SES notifications to a URL
 * production is subscribed with; what these tests pin must not change without saying so in
 * the PR. They were written against the Elysia server and pass unchanged against this one,
 * except where a comment says what differs.
 */
import { describe, expect, it } from "@effect/vitest";
import { EmailAcceptInfrastructureError, EmailAcceptRejected } from "@repo/channels/email/accept";
import { resolveEmailAttachments } from "@repo/channels/email/accept/attachments";
import { ATTACHMENTS_DEADLINE_SECONDS } from "@repo/channels/email/attachment-policy";
import { UsageLimitExceeded } from "@repo/channels/usage";
import { PublicHostLookup } from "@repo/public-url";
import {
  AwsSnsTopicRejected,
  AwsSnsTopicsUnavailable,
  AwsSnsValidationError,
  AwsSubscriptionConfirmationError,
} from "@repo/provider-aws/errors";
import { SES_NOTIFICATIONS_PATH } from "@repo/provider-aws/email/webhooks";
import type { Database } from "@repo/persistence/db/effect";
import { Effect, Fiber, Logger } from "effect";
import { FetchHttpClient } from "effect/http";
import { TestClock } from "effect/testing";
import { GOOD_KEY, request, serve, stubs } from "./testing";

const JSON_TYPE = "application/json;charset=utf-8";
const TEXT_TYPE = "text/plain;charset=utf-8";
const asJson = { "content-type": "application/json" };
const keyed = { ...asJson, "x-api-key": GOOD_KEY };

const respond = (status: number, body: unknown) => ({
  body: JSON.stringify(body),
  contentType: JSON_TYPE,
  status,
});

const email = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    from: "Acme <hello@acme.test>",
    html: "<p>Hi</p>",
    subject: "Hi",
    to: "jane@example.com",
    ...overrides,
  });

const legacyRaw = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    from: "hello@acme.test",
    payload: { html: "<p>Hi</p>", subject: "Hi" },
    to: "jane@example.com",
    ...overrides,
  });

/**
 * A schema failure keeps its status and the documented keys, `type`, `on` and the
 * failing `property`; the rest of the body describes the validator, not the contract.
 */
const expectSchemaFailure = (
  response: { readonly body: string; readonly contentType: string | null; readonly status: number },
  on: "body" | "headers",
  property: string,
) => {
  expect(response.status).toBe(422);
  expect(response.contentType).toBe("application/json");
  expect(JSON.parse(response.body)).toMatchObject({ on, property, type: "validation" });
};

const refused = (message: string) => respond(422, { message, on: "body", type: "validation" });

/**
 * A request that announces 40 MiB and sends 1 KiB: an answer can only come from a handler
 * that isn't waiting for the rest.
 */
const announced = (origin: string, path: string, headers: Record<string, string>) =>
  Effect.promise(async () => {
    let received = "";
    const answered = Promise.withResolvers<string>();
    const socket = await Bun.connect({
      hostname: "127.0.0.1",
      port: Number(new URL(origin).port),
      socket: {
        close: () => answered.resolve(received),
        data: (_socket, chunk) => {
          received += chunk.toString();
          const [head, body] = received.split("\r\n\r\n");
          const length = Number(/content-length: (\d+)/i.exec(head ?? "")?.[1]);
          if (body !== undefined && body.length >= length) {
            answered.resolve(received);
          }
        },
      },
    });
    socket.write(
      [
        `POST ${path} HTTP/1.1`,
        "host: api.test",
        `content-length: ${40 * 1024 * 1024}`,
        ...Object.entries(headers).map(([name, value]) => `${name}: ${value}`),
        "",
        `{"html":"${"a".repeat(1024)}`,
      ].join("\r\n"),
    );
    const response = await Promise.race([
      answered.promise,
      Bun.sleep(2000).then(() => "no answer while the body is unread"),
    ]);
    socket.end();
    const [head, body] = response.split("\r\n\r\n");
    return { body, status: head?.split("\r\n")[0] };
  });

describe("the api's HTTP contract", () => {
  it.live("answers /health, and 404 NOT_FOUND to anything it does not route", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);

      expect(yield* request(origin, "GET", "/health")).toEqual(respond(200, { status: "ok" }));
      expect(yield* request(origin, "GET", "/health/")).toEqual(respond(200, { status: "ok" }));
      expect(yield* request(origin, "HEAD", "/health")).toEqual({
        body: "",
        contentType: JSON_TYPE,
        status: 200,
      });
      const notFound = { body: "NOT_FOUND", contentType: TEXT_TYPE, status: 404 };
      expect(yield* request(origin, "GET", "/nope")).toEqual(notFound);
      expect(yield* request(origin, "POST", "/health", { body: "{}", headers: asJson })).toEqual(
        notFound,
      );
      expect(yield* request(origin, "GET", "/messages/email", { headers: keyed })).toEqual(
        notFound,
      );
      expect(
        yield* request(origin, "OPTIONS", "/messages/email", {
          headers: { "access-control-request-method": "POST", origin: "https://app.test" },
        }),
      ).toEqual(notFound);
      expect(yield* request(origin, "GET", "/send/acme/raw/email", { headers: keyed })).toEqual(
        notFound,
      );
      expect(
        yield* request(origin, "POST", "/send//raw/email", { body: legacyRaw(), headers: keyed }),
      ).toEqual(notFound);
      expect(yield* request(origin, "GET", SES_NOTIFICATIONS_PATH)).toEqual(notFound);
      expect(
        yield* request(origin, "POST", "/Messages/email", { body: email(), headers: keyed }),
      ).toEqual(notFound);
      expect(
        yield* request(origin, "POST", "/messages//email", { body: email(), headers: keyed }),
      ).toEqual(notFound);
    }),
  );
});

describe("POST /messages/email", () => {
  it.live("accepts a send with 201 and the Message id, with or without a trailing slash", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);

      expect(
        yield* request(origin, "POST", "/messages/email", { body: email(), headers: keyed }),
      ).toEqual(respond(201, { id: "msg_1" }));
      expect(
        yield* request(origin, "POST", "/messages/email/", { body: email(), headers: keyed }),
      ).toEqual(respond(201, { id: "msg_1" }));
      expect(
        yield* request(origin, "POST", "/messages/email?ignored=1", {
          body: email(),
          headers: { "content-type": "application/json; charset=utf-8", "X-API-KEY": GOOD_KEY },
        }),
      ).toEqual(respond(201, { id: "msg_1" }));
      expect(accepted).toHaveLength(3);
      expect(accepted[0]).toMatchObject({
        attribution: { kind: "project" },
        email: {
          content: { html: "<p>Hi</p>", kind: "inline", subject: "Hi" },
          from: { address: "hello@acme.test", name: "Acme", normalized: "Acme <hello@acme.test>" },
          to: [{ email: "jane@example.com" }],
        },
        organizationId: "org_1",
      });
    }),
  );

  it.live("accepts every documented recipient and content shape", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);

      for (const body of [
        email({
          to: ["a@example.com", "b@example.com"],
          cc: "c@example.com",
          bcc: ["d@example.com"],
        }),
        email({
          to: [{ email: "a@example.com", first_name: "Ada", properties: { plan: "pro" } }],
          reply_to: ["r@example.com"],
          headers: { "X-Campaign": "spring" },
          tags: [{ name: "kind", value: "receipt" }],
          scheduled_at: "2030-01-01T09:00:00Z",
        }),
        email({
          html: undefined,
          subject: undefined,
          template: { id: "tmpl_1", variables: { order: { items: [1, 2] } } },
        }),
        email({ attachments: [{ content: "SGk=", filename: "hi.txt" }] }),
        email({ attachments: [{ filename: "a.pdf", path: "https://files.test/a.pdf" }] }),
        email({ text: "Hi", html: undefined }),
      ]) {
        expect(yield* request(origin, "POST", "/messages/email", { body, headers: keyed })).toEqual(
          respond(201, { id: "msg_1" }),
        );
      }
      expect(accepted).toHaveLength(6);
    }),
  );

  it.live("passes the App and Environment headers and the Idempotency-Key to accept", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);

      expect(
        yield* request(origin, "POST", "/messages/email", {
          body: email(),
          headers: { ...keyed, app: "web", environment: "prod", "idempotency-key": "order-1" },
        }),
      ).toEqual(respond(201, { id: "msg_1" }));
      expect(accepted[0]).toMatchObject({
        attribution: { app: "web", environment: "prod", kind: "appEnvironment" },
        idempotencyKey: "order-1",
      });
    }),
  );

  it.live("lists stripped recipients next to the id", () =>
    Effect.gen(function* () {
      const origin = yield* serve(
        stubs({
          accept: () =>
            Effect.succeed({
              deliveryId: "edlv_1",
              messageId: "msg_1",
              replayed: false,
              stripped: [{ email: "gone@example.com", reason: "suppression" }],
            }),
        }).stubs,
      );

      expect(
        yield* request(origin, "POST", "/messages/email", { body: email(), headers: keyed }),
      ).toEqual(
        respond(201, {
          id: "msg_1",
          stripped: [{ email: "gone@example.com", reason: "suppression" }],
        }),
      );
    }),
  );

  it.live("refuses a missing x-api-key as a header validation failure", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);

      expectSchemaFailure(
        yield* request(origin, "POST", "/messages/email", { body: email(), headers: asJson }),
        "headers",
        "/x-api-key",
      );
      // Without a key the body is never read, so nothing about it is answered: not that
      // it fails the schema, nor that it isn't JSON.
      for (const body of [email({ to: undefined }), "{not json"]) {
        expectSchemaFailure(
          yield* request(origin, "POST", "/messages/email", { body, headers: asJson }),
          "headers",
          "/x-api-key",
        );
      }
    }),
  );

  it.live("answers a request whose key is missing or unknown without reading its body", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);
      const unfinished = (path: string, key?: string) =>
        announced(origin, path, {
          "content-type": "application/json",
          ...(key === undefined ? {} : { "x-api-key": key }),
        });

      expect(yield* unfinished("/messages/email")).toMatchObject({
        body: expect.stringContaining('"property":"/x-api-key"'),
        status: "HTTP/1.1 422 Unprocessable Entity",
      });
      expect(yield* unfinished("/messages/email", "rel_unknown")).toEqual({
        body: JSON.stringify({ code: "invalid_api_key", message: "Invalid API key" }),
        status: "HTTP/1.1 403 Forbidden",
      });
      expect(yield* unfinished("/send/acme/raw/email")).toEqual({
        body: JSON.stringify({ details: [], message: "Unauthorized" }),
        status: "HTTP/1.1 401 Unauthorized",
      });
      expect(yield* unfinished("/send/acme/raw/email", "rel_unknown")).toEqual({
        body: JSON.stringify({ details: [], message: "Invalid API key" }),
        status: "HTTP/1.1 401 Unauthorized",
      });
      // Another Project's key is refused for the path, its body unread too.
      expect(yield* unfinished("/send/other/raw/email", GOOD_KEY)).toEqual({
        body: JSON.stringify({ details: [], message: "Project not found" }),
        status: "HTTP/1.1 404 Not Found",
      });
      expect(accepted).toEqual([]);
    }),
  );

  it.live("refuses an unknown or empty API key with 403 invalid_api_key", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);
      const invalid = respond(403, { code: "invalid_api_key", message: "Invalid API key" });

      for (const key of ["rel_unknown", ""]) {
        expect(
          yield* request(origin, "POST", "/messages/email", {
            body: email(),
            headers: { ...asJson, "x-api-key": key },
          }),
        ).toEqual(invalid);
      }
      // Authentication comes before everything about the body (its JSON, its schema,
      // its cross-field checks) and before the App headers.
      for (const body of [
        email({ template: { id: "tmpl_1" } }),
        email({ to: undefined }),
        "{not json",
      ]) {
        expect(
          yield* request(origin, "POST", "/messages/email", {
            body,
            headers: { ...asJson, app: "web", "x-api-key": "rel_unknown" },
          }),
        ).toEqual(invalid);
      }
      // A header that fails its schema still comes before the key.
      expectSchemaFailure(
        yield* request(origin, "POST", "/messages/email", {
          body: email(),
          headers: { ...asJson, "idempotency-key": "x".repeat(257), "x-api-key": "rel_unknown" },
        }),
        "headers",
        "/idempotency-key",
      );
      expect(accepted).toEqual([]);
    }),
  );

  it.live("answers 500 when the Project has no owner to bill", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs({ ownerUserId: null }).stubs);

      expect(
        yield* request(origin, "POST", "/messages/email", { body: email(), headers: keyed }),
      ).toEqual(
        respond(500, { code: "internal_server_error", message: "Project owner not found" }),
      );
    }),
  );

  it.live("answers 400 Bad Request to a body that is not JSON", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);
      const badRequest = { body: "Bad Request", contentType: TEXT_TYPE, status: 400 };

      expect(
        yield* request(origin, "POST", "/messages/email", { body: "{not json", headers: keyed }),
      ).toEqual(badRequest);
    }),
  );

  it.live("answers 413 payload_too_large to a body over 50 MiB, before reading it or the key", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);
      const tooLarge = respond(413, {
        code: "payload_too_large",
        message: "Request body exceeds the 50 MiB limit.",
      });
      const withAttachment = (bytes: number) =>
        email({ attachments: [{ content: "A".repeat(bytes), filename: "big.pdf" }] });
      const over = withAttachment(50 * 1024 * 1024);

      for (const path of ["/messages/email", "/send/acme/raw/email"]) {
        expect(yield* request(origin, "POST", path, { body: over, headers: keyed })).toEqual(
          tooLarge,
        );
      }
      expect(
        yield* request(origin, "POST", "/messages/email", { body: over, headers: asJson }),
      ).toEqual(tooLarge);
      // Without a Content-Length, reading stops once it passes the limit.
      const chunked = yield* Effect.promise(async () => {
        const bytes = new TextEncoder().encode(over);
        const response = await fetch(`${origin}/messages/email`, {
          body: new ReadableStream({
            start: (controller) => {
              controller.enqueue(bytes);
              controller.close();
            },
          }),
          duplex: "half",
          headers: keyed,
          method: "POST",
        });
        return {
          body: await response.text(),
          contentType: response.headers.get("content-type"),
          status: response.status,
        };
      });
      expect(chunked).toEqual(tooLarge);
      expect(accepted).toEqual([]);

      // Every deliverable send fits: SES refuses a message over 40 MB.
      expect(
        yield* request(origin, "POST", "/messages/email", {
          body: withAttachment(40 * 1024 * 1024),
          headers: keyed,
        }),
      ).toEqual(respond(201, { id: "msg_1" }));
    }),
  );

  it.live("refuses a body that fails the schema with 422 validation on the failing property", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);
      const send = (body: string, headers: Record<string, string> = keyed) =>
        request(origin, "POST", "/messages/email", { body, headers });

      expectSchemaFailure(yield* send(email({ to: undefined })), "body", "/to");
      expectSchemaFailure(yield* send(email({ to: "not-an-email" })), "body", "/to");
      expectSchemaFailure(
        yield* send(
          email({
            attachments: Array.from({ length: 21 }, (_, i) => ({
              content: "QQ==",
              filename: `${i}.txt`,
            })),
          }),
        ),
        "body",
        "/attachments",
      );
      expectSchemaFailure(
        yield* send(email({ to: Array.from({ length: 51 }, (_, i) => `r${i}@example.com`) })),
        "body",
        "/to",
      );
      expectSchemaFailure(
        yield* send(email({ tags: [{ name: "bad tag", value: "x" }] })),
        "body",
        "/tags/0/name",
      );
      expectSchemaFailure(yield* send(email({ headers: { "X-A": 1 } })), "body", "/headers/X-A");
      expectSchemaFailure(yield* send(email({ subject: 1 })), "body", "/subject");
      expectSchemaFailure(
        yield* send(email({ template: { id: "" }, html: undefined })),
        "body",
        "/template/id",
      );
      expectSchemaFailure(yield* send(email({ from: "" })), "body", "/from");
      expectSchemaFailure(
        yield* send(
          email({
            attachments: [{ content: "SGk=", filename: "a.pdf", path: "https://files.test/a.pdf" }],
          }),
        ),
        "body",
        "/attachments/0",
      );
      expectSchemaFailure(yield* send("null"), "body", "root");
      expectSchemaFailure(yield* send(""), "body", "root");
      // A body that is not an object fails at the root. Elysia reported a JSON array, or a
      // body sent as text, at its first missing property (`/from`).
      expectSchemaFailure(yield* send("[]"), "body", "root");
      expectSchemaFailure(
        yield* send(email(), { ...keyed, "idempotency-key": "x".repeat(257) }),
        "headers",
        "/idempotency-key",
      );
      // A body that is not JSON-typed is not parsed, so it is not an object.
      expectSchemaFailure(
        yield* send(email(), { "content-type": "text/plain", "x-api-key": GOOD_KEY }),
        "body",
        "root",
      );
      expectSchemaFailure(yield* send(email(), { "x-api-key": GOOD_KEY }), "body", "root");
      expect(accepted).toEqual([]);
    }),
  );

  it.live("refuses topic_id with 422, and ignores any other field it does not know", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);
      const send = (body: string) =>
        request(origin, "POST", "/messages/email", { body, headers: keyed });

      // A sender who names a Topic believes its consent was applied; it was not.
      for (const topic of ["topic_123", "", null]) {
        const refusal = yield* send(email({ topic_id: topic }));
        expectSchemaFailure(refusal, "body", "/topic_id");
        expect(JSON.parse(refusal.body)).toMatchObject({
          message: "topic_id is not supported: this endpoint applies no Topic consent",
        });
      }
      expect(accepted).toEqual([]);

      // A Resend client sending a field Relayit doesn't know keeps working, at the top
      // level and inside a Contact or an attachment.
      expect(
        yield* send(
          email({
            attachments: [{ content: "SGk=", filename: "hi.txt", size: 2 }],
            audience_id: "aud_1",
            to: [{ email: "jane@example.com", nickname: "J" }],
          }),
        ),
      ).toEqual(respond(201, { id: "msg_1" }));
      expect(accepted).toHaveLength(1);
      expect(accepted[0]?.email).not.toHaveProperty("audience_id");
    }),
  );

  it.live("refuses what the schema allows but a send cannot use, with its message", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);
      const send = (body: string) =>
        request(origin, "POST", "/messages/email", { body, headers: keyed });

      expect(yield* send(email({ from: "nope" }))).toEqual(refused("Invalid from address"));
      const eitherOr = refused(
        "Provide either inline html/text or template, not both (and not neither).",
      );
      expect(yield* send(email({ template: { id: "tmpl_1" } }))).toEqual(eitherOr);
      expect(yield* send(email({ html: undefined }))).toEqual(eitherOr);
      expect(yield* send(email({ subject: undefined }))).toEqual(
        refused("subject is required when sending inline html/text"),
      );
      expect(yield* send(email({ subject: "" }))).toEqual(
        refused("subject is required when sending inline html/text"),
      );
      expect(yield* send(email({ scheduled_at: "someday" }))).toEqual(
        refused("scheduled_at must be a parseable date (ISO 8601 preferred)"),
      );
      expect(
        yield* send(email({ attachments: [{ content: "AA==", filename: "setup.exe" }] })),
      ).toEqual(refused("This file type isn't allowed for security reasons."));
      expect(accepted).toEqual([]);
    }),
  );

  it.live("refuses one of the App and Environment headers without the other with 400", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);
      const unpaired = respond(400, {
        code: "invalid_app_environment",
        message: "App and Environment headers must both be present, or both omitted.",
      });

      expect(
        yield* request(origin, "POST", "/messages/email", {
          body: email(),
          headers: { ...keyed, app: "web" },
        }),
      ).toEqual(unpaired);
      expect(
        yield* request(origin, "POST", "/messages/email", {
          body: email(),
          headers: { ...keyed, environment: "prod" },
        }),
      ).toEqual(unpaired);
      expect(accepted).toEqual([]);
    }),
  );

  it.live("answers 422 with accept's code when every recipient is suppressed", () =>
    Effect.gen(function* () {
      const origin = yield* serve(
        stubs({
          accept: () =>
            Effect.fail(
              new EmailAcceptRejected({
                code: "all_recipients_suppressed",
                message:
                  "Every recipient is suppressed at severity all; no deliverable addresses remain.",
              }),
            ),
        }).stubs,
      );

      expect(
        yield* request(origin, "POST", "/messages/email", { body: email(), headers: keyed }),
      ).toEqual(
        respond(422, {
          code: "all_recipients_suppressed",
          message:
            "Every recipient is suppressed at severity all; no deliverable addresses remain.",
        }),
      );
    }),
  );

  it.effect("answers 422 fetch_timeout when hosted attachments outlast the send's deadline", () =>
    Effect.gen(function* () {
      // Accept's own attachment resolution, against a host that never answers.
      const fetched: string[] = [];
      const neverAnswers = Object.assign(
        (input: string | URL | Request) => {
          fetched.push(String(input));
          return new Promise<Response>(() => undefined);
        },
        { preconnect: globalThis.fetch.preconnect },
      );
      const origin = yield* serve(
        stubs({
          accept: (input) =>
            resolveEmailAttachments(input.email.attachments, input.organizationId).pipe(
              Effect.provideService(FetchHttpClient.Fetch, neverAnswers),
              Effect.provideService(PublicHostLookup, {
                resolve: () => Promise.resolve(["93.184.215.14"]),
              }),
              Effect.as({
                deliveryId: "edlv_1",
                messageId: "msg_1",
                replayed: false,
                stripped: [],
              }),
            ),
        }).stubs,
      );

      const response = yield* request(origin, "POST", "/messages/email", {
        body: email({
          attachments: [{ filename: "slow.pdf", path: "https://files.example.com/slow.pdf" }],
        }),
        headers: keyed,
      }).pipe(Effect.forkChild);
      yield* Effect.promise(async () => {
        while (fetched.length === 0) {
          await Bun.sleep(1);
        }
      });
      yield* TestClock.adjust(`${ATTACHMENTS_DEADLINE_SECONDS + 1} seconds`);
      const answered = yield* Effect.raceFirst(
        Fiber.join(response),
        Effect.promise(() => Bun.sleep(2000)).pipe(Effect.as("no answer after the deadline")),
      );
      // Lets anything still waiting on the clock finish, so the server can shut down.
      yield* TestClock.adjust("1 hour");
      expect(answered).toEqual(
        respond(422, {
          code: "invalid_attachment",
          message: "Attachments did not finish within the time limit.",
          details: { reason: "fetch_timeout" },
        }),
      );
    }),
  );

  it.live("answers 422 with snake_case details when accept gives them", () =>
    Effect.gen(function* () {
      const origin = yield* serve(
        stubs({
          accept: () =>
            Effect.fail(
              new EmailAcceptRejected({
                code: "invalid_attachment",
                details: {
                  detail: "over the limit",
                  filename: "a.pdf",
                  maxBytes: 10,
                  reason: "exceeds_size_limit",
                  status: 413,
                  variable: "name",
                },
                message: "Attachment is too large.",
              }),
            ),
        }).stubs,
      );

      expect(
        yield* request(origin, "POST", "/messages/email", { body: email(), headers: keyed }),
      ).toEqual(
        respond(422, {
          code: "invalid_attachment",
          message: "Attachment is too large.",
          details: {
            detail: "over the limit",
            filename: "a.pdf",
            max_bytes: 10,
            reason: "exceeds_size_limit",
            status: 413,
            variable: "name",
          },
        }),
      );
    }),
  );

  it.live("answers 429 with the seconds until the limit resets", () =>
    Effect.gen(function* () {
      const daily = yield* serve(
        stubs({
          accept: () =>
            Effect.fail(
              new UsageLimitExceeded({
                deliveryId: "edlv_1",
                retryAt: new Date(Date.now() + 3_600_000),
                window: "daily",
              }),
            ),
        }).stubs,
      );
      expect(
        yield* request(daily, "POST", "/messages/email", { body: email(), headers: keyed }),
      ).toEqual(
        respond(429, {
          code: "daily_limit_exceeded",
          message: "Daily email send limit exceeded",
          retry_after_seconds: 3600,
        }),
      );

      const monthly = yield* serve(
        stubs({
          accept: () =>
            Effect.fail(
              new UsageLimitExceeded({
                deliveryId: "edlv_1",
                retryAt: new Date(Date.now() - 5000),
                window: "monthly",
              }),
            ),
        }).stubs,
      );
      expect(
        yield* request(monthly, "POST", "/messages/email", { body: email(), headers: keyed }),
      ).toEqual(
        respond(429, {
          code: "monthly_limit_exceeded",
          message: "Monthly email send limit exceeded",
          retry_after_seconds: 1,
        }),
      );
    }),
  );

  it.live("answers 500 without internals when accept fails for another reason", () =>
    Effect.gen(function* () {
      const origin = yield* serve(
        stubs({
          accept: () =>
            Effect.fail(
              new EmailAcceptInfrastructureError({
                cause: new Error("connection reset by peer"),
                operation: "sender",
                organizationId: "org_1",
              }),
            ),
        }).stubs,
      );

      expect(
        yield* request(origin, "POST", "/messages/email", { body: email(), headers: keyed }),
      ).toEqual(
        respond(500, {
          code: "internal_server_error",
          message: "Failed to accept email message.",
        }),
      );
    }),
  );
});

describe("POST /send/:project/raw/email and /template/email", () => {
  it.live("accepts with 201 queued, the key in either header spelling", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);
      const queued = respond(201, { id: "msg_1", status: "queued" });

      expect(
        yield* request(origin, "POST", "/send/acme/raw/email", {
          body: legacyRaw(),
          headers: keyed,
        }),
      ).toEqual(queued);
      expect(
        yield* request(origin, "POST", "/send/acme/raw/email/", {
          body: legacyRaw(),
          headers: { ...asJson, "X-API-Key": GOOD_KEY },
        }),
      ).toEqual(queued);
      expect(
        yield* request(origin, "POST", "/send/acme/template/email", {
          body: JSON.stringify({
            from: "hello@acme.test",
            template: { props: { name: "Ada" }, slug: "welcome" },
            to: "jane@example.com",
          }),
          headers: keyed,
        }),
      ).toEqual(queued);
      expect(accepted).toHaveLength(3);
      expect(accepted[0]).toMatchObject({
        attribution: { kind: "project" },
        organizationId: "org_1",
      });
      expect(accepted[2]).toMatchObject({
        email: { content: { idOrSlug: "welcome", kind: "template", values: { name: "Ada" } } },
      });
    }),
  );

  it.live("sends from the Project's verified Domain when the body has no from", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs({ defaultDomain: "acme.test" });
      const origin = yield* serve(boundary);

      expect(
        yield* request(origin, "POST", "/send/acme/raw/email", {
          body: legacyRaw({ from: undefined }),
          headers: keyed,
        }),
      ).toEqual(respond(201, { id: "msg_1", status: "queued" }));
      expect(accepted[0]).toMatchObject({ email: { from: { address: "noreply@acme.test" } } });
    }),
  );

  it.live("refuses a missing or invalid key with 401, and another Project's slug with 404", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);

      expect(
        yield* request(origin, "POST", "/send/acme/raw/email", {
          body: legacyRaw(),
          headers: asJson,
        }),
      ).toEqual(respond(401, { details: [], message: "Unauthorized" }));
      expect(
        yield* request(origin, "POST", "/send/acme/raw/email", {
          body: legacyRaw(),
          headers: { ...asJson, "x-api-key": "rel_unknown" },
        }),
      ).toEqual(respond(401, { details: [], message: "Invalid API key" }));
      expect(
        yield* request(origin, "POST", "/send/other/raw/email", {
          body: legacyRaw(),
          headers: keyed,
        }),
      ).toEqual(respond(404, { details: [], message: "Project not found" }));
      // The key comes before the body: one that fails the schema, or isn't JSON, changes
      // none of these answers.
      for (const body of [legacyRaw({ to: "bad" }), "{oops"]) {
        expect(
          yield* request(origin, "POST", "/send/acme/raw/email", { body, headers: asJson }),
        ).toEqual(respond(401, { details: [], message: "Unauthorized" }));
        expect(
          yield* request(origin, "POST", "/send/other/raw/email", { body, headers: keyed }),
        ).toEqual(respond(404, { details: [], message: "Project not found" }));
      }
      expect(accepted).toEqual([]);
    }),
  );

  it.live("refuses a send with no from and nowhere to send from with 400", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);

      expect(
        yield* request(origin, "POST", "/send/acme/template/email", {
          body: JSON.stringify({ template: { slug: "welcome" }, to: "jane@example.com" }),
          headers: keyed,
        }),
      ).toEqual(
        respond(400, {
          details: [],
          message: "No sender identity available; pass from or provision Sandbox Domain",
        }),
      );
    }),
  );

  it.live("refuses a body that fails the schema with 422 validation", () =>
    Effect.gen(function* () {
      const { accepted, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);
      const send = (path: string, body: string, headers: Record<string, string> = keyed) =>
        request(origin, "POST", path, { body, headers });

      expectSchemaFailure(
        yield* send("/send/acme/raw/email", legacyRaw({ to: "bad" })),
        "body",
        "/to",
      );
      expectSchemaFailure(
        yield* send("/send/acme/raw/email", legacyRaw({ from: "Acme <hello@acme.test>" })),
        "body",
        "/from",
      );
      expectSchemaFailure(
        yield* send("/send/acme/raw/email", legacyRaw({ payload: { subject: "Hi" } })),
        "body",
        "/payload",
      );
      expectSchemaFailure(
        yield* send(
          "/send/acme/raw/email",
          legacyRaw({
            attachments: Array.from({ length: 21 }, () => ({ content: "QQ==", filename: "a.txt" })),
          }),
        ),
        "body",
        "/attachments",
      );
      expectSchemaFailure(
        yield* send(
          "/send/acme/template/email",
          JSON.stringify({
            from: "hello@acme.test",
            template: { slug: "" },
            to: "jane@example.com",
          }),
        ),
        "body",
        "/template/slug",
      );
      expect(yield* send("/send/acme/raw/email", "{oops")).toEqual({
        body: "Bad Request",
        contentType: TEXT_TYPE,
        status: 400,
      });
      expect(accepted).toEqual([]);
    }),
  );

  it.live("maps accept's refusals to the legacy shapes", () =>
    Effect.gen(function* () {
      const suppressed = yield* serve(
        stubs({
          accept: () =>
            Effect.fail(
              new EmailAcceptRejected({
                code: "all_recipients_suppressed",
                message:
                  "Every recipient is suppressed at severity all; no deliverable addresses remain.",
              }),
            ),
        }).stubs,
      );
      expect(
        yield* request(suppressed, "POST", "/send/acme/raw/email", {
          body: legacyRaw(),
          headers: keyed,
        }),
      ).toEqual(
        respond(400, {
          details: ["all_recipients_suppressed"],
          message:
            "Every recipient is suppressed at severity all; no deliverable addresses remain.",
        }),
      );

      const limited = yield* serve(
        stubs({
          accept: () =>
            Effect.fail(
              new UsageLimitExceeded({
                deliveryId: "edlv_1",
                retryAt: new Date(Date.now() + 60_000),
                window: "daily",
              }),
            ),
        }).stubs,
      );
      expect(
        yield* request(limited, "POST", "/send/acme/raw/email", {
          body: legacyRaw(),
          headers: keyed,
        }),
      ).toEqual(
        respond(429, {
          details: ["daily_limit_exceeded"],
          message: "Daily email send limit exceeded",
        }),
      );

      const broken = yield* serve(
        stubs({
          accept: () =>
            Effect.fail(
              new EmailAcceptInfrastructureError({
                cause: new Error("connection reset by peer"),
                operation: "sender",
                organizationId: "org_1",
              }),
            ),
        }).stubs,
      );
      expect(
        yield* request(broken, "POST", "/send/acme/template/email", {
          body: JSON.stringify({
            from: "hello@acme.test",
            template: { slug: "w" },
            to: "j@example.com",
          }),
          headers: keyed,
        }),
      ).toEqual(respond(500, { details: [], message: "Something went wrong" }));
    }),
  );
});

describe(`POST ${SES_NOTIFICATIONS_PATH}`, () => {
  it.live("hands SNS's raw body to the ingest whatever its content type, and answers 200", () =>
    Effect.gen(function* () {
      const { received, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);
      const body = '{"Type":"Notification","Message":"{}"}';

      for (const headers of [
        { "content-type": "text/plain; charset=UTF-8" },
        { "content-type": "application/json" },
        {} as Record<string, string>,
      ]) {
        expect(yield* request(origin, "POST", SES_NOTIFICATIONS_PATH, { body, headers })).toEqual(
          respond(200, { ok: true }),
        );
      }
      expect(received).toEqual([body, body, body]);
    }),
  );

  it.live("answers 400 to a body larger than SNS sends, without reading it", () =>
    Effect.gen(function* () {
      const { received, stubs: boundary } = stubs();
      const origin = yield* serve(boundary);
      const rejected = { code: "bad_request", message: "SES notification handling failed" };

      expect(yield* announced(origin, SES_NOTIFICATIONS_PATH, {})).toEqual({
        body: JSON.stringify(rejected),
        status: "HTTP/1.1 400 Bad Request",
      });
      // Without a Content-Length, reading stops once it passes the limit.
      const chunked = yield* Effect.promise(async () => {
        const response = await fetch(`${origin}${SES_NOTIFICATIONS_PATH}`, {
          body: new ReadableStream({
            start: (controller) => {
              controller.enqueue(new TextEncoder().encode("a".repeat(2 * 1024 * 1024)));
              controller.close();
            },
          }),
          duplex: "half",
          method: "POST",
        });
        return { body: await response.text(), status: response.status };
      });
      expect(chunked).toEqual({ body: JSON.stringify(rejected), status: 400 });
      expect(received).toEqual([]);

      // The most SNS sends, 256 KB of message escaped to twice that, is read.
      const largest = "a".repeat(600 * 1024);
      expect(yield* request(origin, "POST", SES_NOTIFICATIONS_PATH, { body: largest })).toEqual(
        respond(200, { ok: true }),
      );
      expect(received).toEqual([largest]);
    }),
  );

  it.live("answers 400 to a notification that fails SNS's checks, which SNS does not retry", () =>
    Effect.gen(function* () {
      const origin = yield* serve(
        stubs({ handleSes: () => Effect.fail(new AwsSnsValidationError({})) }).stubs,
      );

      expect(
        yield* request(origin, "POST", SES_NOTIFICATIONS_PATH, {
          body: "not sns",
          headers: { "content-type": "text/plain" },
        }),
      ).toEqual(respond(400, { code: "bad_request", message: "SES notification handling failed" }));
    }),
  );

  it.live("answers 400 to a notification from a topic this deployment did not subscribe", () =>
    Effect.gen(function* () {
      const origin = yield* serve(
        stubs({
          handleSes: () => Effect.fail(new AwsSnsTopicRejected({ topicArn: "arn:aws:sns:x" })),
        }).stubs,
      );

      expect(
        yield* request(origin, "POST", SES_NOTIFICATIONS_PATH, {
          body: '{"Type":"Notification"}',
          headers: { "content-type": "text/plain" },
        }),
      ).toEqual(respond(400, { code: "bad_request", message: "SES notification handling failed" }));
    }),
  );

  it.live("answers 500 when it cannot look up which topics to trust, so SNS retries", () =>
    Effect.gen(function* () {
      const origin = yield* serve(
        stubs({
          handleSes: () =>
            Effect.fail(new AwsSnsTopicsUnavailable({ cause: new Error("STS unreachable") })),
        }).stubs,
      );

      expect(
        yield* request(origin, "POST", SES_NOTIFICATIONS_PATH, {
          body: '{"Type":"Notification"}',
          headers: { "content-type": "text/plain" },
        }),
      ).toEqual(
        respond(500, {
          code: "internal_server_error",
          message: "SES notification handling failed",
        }),
      );
    }),
  );

  it.live(
    "answers 500 when SNS could not be reached to confirm, and 400 to a bad SubscribeURL",
    () =>
      Effect.gen(function* () {
        const confirming = (reason: "invalid_url" | "request_failed") =>
          serve(
            stubs({
              handleSes: () => Effect.fail(new AwsSubscriptionConfirmationError({ reason })),
            }).stubs,
          ).pipe(
            Effect.flatMap((origin) =>
              request(origin, "POST", SES_NOTIFICATIONS_PATH, {
                body: '{"Type":"SubscriptionConfirmation"}',
                headers: { "content-type": "text/plain" },
              }),
            ),
          );

        expect(yield* confirming("request_failed")).toEqual(
          respond(500, {
            code: "internal_server_error",
            message: "SES notification handling failed",
          }),
        );
        expect(yield* confirming("invalid_url")).toEqual(
          respond(400, { code: "bad_request", message: "SES notification handling failed" }),
        );
      }),
  );

  it.live(
    "answers 500, without logging an error, to a notification that beat its Delivery's record",
    () => {
      const logged: { readonly level: string; readonly message: unknown }[] = [];
      return Effect.gen(function* () {
        const origin = yield* serve(
          stubs({
            // No Delivery carries the message id yet.
            db: {
              query: { emailDelivery: { findFirst: () => Effect.succeed(undefined) } },
            } as unknown as Database,
            handleSes: () =>
              Effect.succeed({
                events: [
                  {
                    kind: "accepted",
                    notificationId: "sns-message-id",
                    providerMessageId: "ses-message-id",
                    raw: {},
                    recipients: ["jane@example.com"],
                    sentAt: new Date(),
                    suppress: false,
                  },
                ],
                type: "events",
              }),
          }).stubs,
        );

        expect(
          yield* request(origin, "POST", SES_NOTIFICATIONS_PATH, {
            body: '{"Type":"Notification"}',
            headers: { "content-type": "text/plain" },
          }),
        ).toEqual(
          respond(500, {
            code: "internal_server_error",
            message: "SES notification handling failed",
          }),
        );
        expect(logged.map(({ level }) => level)).toEqual(["Info"]);
      }).pipe(
        Effect.provide(
          Logger.layer([
            Logger.make(({ logLevel, message }) => void logged.push({ level: logLevel, message })),
          ]),
        ),
      );
    },
  );

  it.live("answers 500 when it cannot record the outcome, so SNS retries", () =>
    Effect.gen(function* () {
      const origin = yield* serve(
        stubs({ handleSes: () => Effect.die(new Error("database unreachable")) }).stubs,
      );

      expect(
        yield* request(origin, "POST", SES_NOTIFICATIONS_PATH, {
          body: '{"Type":"Notification"}',
          headers: { "content-type": "text/plain" },
        }),
      ).toEqual(
        respond(500, {
          code: "internal_server_error",
          message: "SES notification handling failed",
        }),
      );
    }),
  );
});

describe("GET /docs and /openapi.json", () => {
  it.live("serve the API reference and its OpenAPI document", () =>
    Effect.gen(function* () {
      const origin = yield* serve(stubs().stubs);

      const docs = yield* request(origin, "GET", "/docs");
      expect(docs.status).toBe(200);
      expect(docs.contentType).toMatch(/^text\/html/);
      const spec = yield* request(origin, "GET", "/openapi.json");
      expect(spec.status).toBe(200);
      expect(JSON.parse(spec.body)).toMatchObject({
        paths: {
          "/send/{project}/raw/email": { post: expect.any(Object) },
          "/send/{project}/template/email": { post: expect.any(Object) },
        },
      });
      expect(Object.keys(JSON.parse(spec.body).paths)).not.toContain(SES_NOTIFICATIONS_PATH);
    }),
  );
});
