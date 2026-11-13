/**
 * The api's HTTP contract: requests in, exact status, content type and body out, over a
 * real Bun server. `/messages/email` and the legacy `/send/*` are customer contracts, and
 * SNS posts SES notifications to a URL production is subscribed with; what these tests
 * pin must not change without saying so in the PR. The boundaries behind the routes (API
 * key verification, the Project lookups, accept and the SES ingest) are stubs, so every
 * outcome a route maps is reachable without a database.
 */
import openapi from "@elysia/openapi";
import { describe, expect, it } from "@effect/vitest";
import {
  type AcceptTransactionalEmailInput,
  type acceptTransactionalEmail,
  EmailAcceptInfrastructureError,
  EmailAcceptRejected,
} from "@repo/channels/email/accept";
import { Usage, UsageLimitExceeded, type UsageService } from "@repo/channels/usage";
import { Jobs, type JobsService } from "@repo/jobs";
import { ObjectStorage, type ObjectStorageService } from "@repo/object-storage";
import { DB, type Database } from "@repo/persistence/db/effect";
import { AwsSnsValidationError } from "@repo/provider-aws/errors";
import {
  type handleSesNotification,
  SES_NOTIFICATIONS_PATH,
} from "@repo/provider-aws/email/webhooks";
import { Effect, FiberSet, Layer } from "effect";
import { HttpClient } from "effect/http";
import { Elysia } from "elysia";
import type { ApiAuth } from "./lib/auth";
import type { ApiServices, RunApiEffect } from "./lib/effect";
import { createLegacySendRoutes } from "./routes/compat/send";
import { createEmailRoutes } from "./routes/messages/email";
import { createSesNotificationRoutes } from "./routes/webhooks/ses";

const GOOD_KEY = "rel_good";

interface Stubs {
  readonly accept: typeof acceptTransactionalEmail;
  readonly handleSes: typeof handleSesNotification;
  /** The verified custom Domain a legacy send without `from` falls back to. */
  readonly defaultDomain: string | null;
  readonly ownerUserId: string | null;
}

const stubs = (overrides: Partial<Stubs> = {}) => {
  const accepted: AcceptTransactionalEmailInput[] = [];
  const accept =
    overrides.accept ??
    (() =>
      Effect.succeed({ deliveryId: "edlv_1", messageId: "msg_1", replayed: false, stripped: [] }));
  const received: string[] = [];
  const handleSes = overrides.handleSes ?? (() => Effect.succeed({ type: "noop" as const }));
  return {
    accepted,
    received,
    stubs: {
      defaultDomain: null,
      ownerUserId: "user_1",
      ...overrides,
      accept: ((input) => {
        accepted.push(input);
        return accept(input);
      }) satisfies typeof acceptTransactionalEmail,
      handleSes: ((rawBody) => {
        received.push(rawBody);
        return handleSes(rawBody);
      }) satisfies typeof handleSesNotification,
    } satisfies Stubs,
  };
};

const makeAuth = (stubs: Stubs): ApiAuth => ({
  auth: {
    api: {
      verifyApiKey: ({ body }: { body: { key: string } }) =>
        Promise.resolve(
          body.key === GOOD_KEY
            ? { error: null, key: { id: "key_1", referenceId: "org_1" }, valid: true }
            : {
                error: { code: "INVALID_API_KEY", message: "Invalid API key" },
                key: null,
                valid: false,
              },
        ),
    },
  } as unknown as ApiAuth["auth"],
  close: () => Promise.resolve(),
  db: {
    query: {
      member: {
        findFirst: () =>
          Promise.resolve(stubs.ownerUserId === null ? undefined : { userId: stubs.ownerUserId }),
      },
      organization: {
        findFirst: () => Promise.resolve({ id: "org_1", sandboxDomain: null, slug: "acme" }),
      },
      organizationDomain: {
        findFirst: () =>
          Promise.resolve(
            stubs.defaultDomain === null
              ? undefined
              : { customDomain: { fqdn: stubs.defaultDomain }, customDomainId: "dom_1" },
          ),
      },
    },
  } as unknown as ApiAuth["db"],
});

// The routes reach these only through accept and the SES ingest, which are stubbed.
const unusedServices = Layer.mergeAll(
  Layer.succeed(DB, {} as Database),
  Layer.succeed(Jobs, {} as JobsService),
  Layer.succeed(HttpClient.HttpClient, {} as HttpClient.HttpClient),
  Layer.succeed(ObjectStorage, {} as ObjectStorageService),
  Layer.succeed(Usage, {} as UsageService),
);

/** The api as it serves, on a free port of 127.0.0.1, for the length of the test. */
const serve = (stubs: Stubs) =>
  Effect.gen(function* () {
    const auth = makeAuth(stubs);
    const runEffect: RunApiEffect = yield* FiberSet.makeRuntimePromise<ApiServices>();
    const app = new Elysia()
      .use(
        openapi({
          exclude: { paths: ["/health", SES_NOTIFICATIONS_PATH] },
          path: "/docs",
          provider: "scalar",
          specPath: "/openapi.json",
        }),
      )
      .get("/health", () => ({ status: "ok" as const }), { detail: { hide: true } })
      .use(createLegacySendRoutes(auth, runEffect, stubs.accept))
      .group("/messages", (group) => group.use(createEmailRoutes(auth, runEffect, stubs.accept)))
      .use(createSesNotificationRoutes(runEffect, stubs.handleSes));
    yield* Effect.acquireRelease(
      Effect.sync(() => app.listen({ hostname: "127.0.0.1", port: 0 })),
      () => Effect.promise(() => app.stop()),
    );
    return `http://127.0.0.1:${app.server?.port}`;
  }).pipe(Effect.provide(unusedServices));

const request = (
  origin: string,
  method: string,
  path: string,
  options: { readonly body?: string; readonly headers?: Record<string, string> } = {},
) =>
  Effect.promise(async () => {
    const response = await fetch(`${origin}${path}`, {
      body: options.body,
      headers: options.headers,
      method,
    });
    return {
      body: await response.text(),
      contentType: response.headers.get("content-type"),
      status: response.status,
    };
  });

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
      // Authentication comes before the body's cross-field checks and the App headers.
      expect(
        yield* request(origin, "POST", "/messages/email", {
          body: email({ template: { id: "tmpl_1" } }),
          headers: { ...asJson, app: "web", "x-api-key": "rel_unknown" },
        }),
      ).toEqual(invalid);
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
      // Parsing comes before the API key is looked at.
      expect(
        yield* request(origin, "POST", "/messages/email", { body: "{not json", headers: asJson }),
      ).toEqual(badRequest);
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
      expectSchemaFailure(yield* send("null"), "body", "root");
      expectSchemaFailure(yield* send(""), "body", "root");
      expectSchemaFailure(yield* send("[]"), "body", "/from");
      expectSchemaFailure(
        yield* send(email(), { ...keyed, "idempotency-key": "x".repeat(257) }),
        "headers",
        "/idempotency-key",
      );
      // A body that is not JSON-typed is not parsed, so it is not an object.
      expectSchemaFailure(
        yield* send(email(), { "content-type": "text/plain", "x-api-key": GOOD_KEY }),
        "body",
        "/from",
      );
      expectSchemaFailure(yield* send(email(), { "x-api-key": GOOD_KEY }), "body", "root");
      // The schema is checked before the API key.
      expectSchemaFailure(
        yield* send(email({ to: undefined }), { ...asJson, "x-api-key": "rel_unknown" }),
        "body",
        "/to",
      );
      expect(accepted).toEqual([]);
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

  it.live("refuses a body that fails the schema with 422 validation, before the key", () =>
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
      expectSchemaFailure(
        yield* send("/send/acme/raw/email", legacyRaw({ to: "bad" }), asJson),
        "body",
        "/to",
      );
      expectSchemaFailure(
        yield* send("/send/other/raw/email", legacyRaw({ payload: { subject: "Hi" } })),
        "body",
        "/payload",
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
