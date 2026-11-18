/**
 * The api over a real Bun server for a test, with the boundaries behind the routes stubbed:
 * API key verification, the Project lookups, accept and the SES ingest. Every outcome a
 * route maps is reachable without a database.
 */
import type {
  AcceptTransactionalEmailInput,
  acceptTransactionalEmail,
} from "@repo/channels/email/accept";
import { Usage, type UsageService } from "@repo/channels/usage";
import { Jobs, type JobsService } from "@repo/jobs";
import { ObjectStorage, type ObjectStorageService } from "@repo/object-storage";
import { DB, type Database } from "@repo/persistence/db/effect";
import type { handleSesNotification } from "@repo/provider-aws/email/webhooks";
import { Context, Effect, Layer } from "effect";
import { HttpClient, HttpServer } from "effect/http";
import { apiServer } from "./http";
import { ApiAuth } from "./lib/auth";

/** The one API key the stubbed better-auth accepts; it belongs to Project `acme` (`org_1`). */
export const GOOD_KEY = "rel_good";

export interface Stubs {
  readonly accept: typeof acceptTransactionalEmail;
  readonly handleSes: typeof handleSesNotification;
  /** The verified custom Domain a legacy send without `from` falls back to. */
  readonly defaultDomain: string | null;
  readonly ownerUserId: string | null;
}

/** Boundaries that accept every send; override one to reach another outcome. */
export const stubs = (overrides: Partial<Stubs> = {}) => {
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

const makeAuth = (stubs: Stubs): ApiAuth["Service"] => ({
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
  } as unknown as ApiAuth["Service"]["auth"],
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
  } as unknown as ApiAuth["Service"]["db"],
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
export const serve = (stubs: Stubs) =>
  Effect.gen(function* () {
    const services = yield* Layer.build(
      apiServer({
        accept: stubs.accept,
        handleSes: stubs.handleSes,
        hostname: "127.0.0.1",
        port: 0,
      }).pipe(
        Layer.provide(Layer.succeed(ApiAuth, makeAuth(stubs))),
        Layer.provide(unusedServices),
      ),
    );
    const { address } = Context.get(services, HttpServer.HttpServer);
    if (address._tag === "UnixPathAddress") {
      return yield* Effect.die("the api listens on TCP");
    }
    return `http://127.0.0.1:${address.port}`;
  });

/** One request to `origin`, read whole. */
export const request = (
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
