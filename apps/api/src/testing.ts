/**
 * The api over a real Bun server for a test, with the boundaries behind the routes stubbed:
 * API key verification, the Project lookups, accept and the SES ingest. Every outcome a
 * route maps is reachable without a database.
 */
import type {
  AcceptTransactionalEmailInput,
  acceptTransactionalEmail,
} from "@repo/channels/email/accept";
import { EmailBackend } from "@repo/channels/email/backend";
import { EmailManagedDns } from "@repo/channels/email/managed-dns";
import { Usage, type UsageService } from "@repo/channels/usage";
import { Jobs, type JobsService } from "@repo/jobs";
import { ObjectStorage, type ObjectStorageService } from "@repo/object-storage";
import { SymmetricCrypto } from "@repo/persistence/crypto/symmetric";
import { DB, type Database } from "@repo/persistence/db/effect";
import type { handleListUnsubscribeOneClick } from "@repo/channels/email/deliverability";
import {
  type handleSesNotification,
  SesNotificationTopics,
} from "@repo/provider-aws/email/webhooks";
import { Context, Effect, Layer } from "effect";
import { HttpServer } from "effect/http";
import { apiServer } from "./http";
import { ApiAuth } from "./lib/auth";

/** The dashboard's origin the api is served with. */
export const APP_ORIGIN = "http://app.test";

/** The one API key the stubbed better-auth accepts; it belongs to Project `acme` (`org_1`). */
export const GOOD_KEY = "rel_good";

export interface Stubs {
  readonly unsubscribe?: typeof handleListUnsubscribeOneClick;
  readonly accept: typeof acceptTransactionalEmail;
  readonly handleSes: typeof handleSesNotification;
  /** The verified custom Domain a legacy send without `from` falls back to. */
  readonly defaultDomain: string | null;
  readonly ownerUserId: string | null;
  /** What SES ingest reads Deliveries and Projects from, for the tests that reach it. */
  readonly db?: Database;
  /** SES, for the tests that have the api ask it for a Project's sending status. */
  readonly emailBackend?: Pick<
    EmailBackend["Service"],
    "defaultRegion" | "getProjectSendingStatus"
  >;
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
      // No request here carries a session; the dashboard's are tested with real ones.
      getSession: () => Promise.resolve(null),
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

// The public routes reach these only through accept and the SES ingest, which are
// stubbed; the dashboard's are tested against real ones (`dashboard/*.test.ts`).
const unusedServices = Layer.mergeAll(
  Layer.succeed(EmailManagedDns, {} as EmailManagedDns["Service"]),
  Layer.succeed(SymmetricCrypto, {} as SymmetricCrypto["Service"]),
  Layer.succeed(Jobs, {} as JobsService),
  Layer.succeed(ObjectStorage, {} as ObjectStorageService),
  Layer.succeed(Usage, {} as UsageService),
  Layer.succeed(SesNotificationTopics, {} as SesNotificationTopics["Service"]),
);

/** The api as it serves, on a free port of 127.0.0.1, for the length of the test. */
export const serve = (stubs: Stubs) =>
  Effect.gen(function* () {
    const services = yield* Layer.build(
      apiServer({
        accept: stubs.accept,
        appOrigin: APP_ORIGIN,
        dashboard: { billing: false, githubSignIn: false },
        handleSes: stubs.handleSes,
        hostname: "127.0.0.1",
        port: 0,
        unsubscribe: stubs.unsubscribe,
        unsubscribeSecrets: ["test-secret"],
      }).pipe(
        Layer.provide(Layer.succeed(ApiAuth, makeAuth(stubs))),
        Layer.provide(unusedServices),
        Layer.provide(
          Layer.succeed(EmailBackend, (stubs.emailBackend ?? {}) as EmailBackend["Service"]),
        ),
        Layer.provide(Layer.succeed(DB, stubs.db ?? ({} as Database))),
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

/**
 * A request that announces `bytes` (40 MiB unless given) and sends 1 KiB: an answer can only
 * come from a handler that isn't waiting for the rest.
 */
export const announced = (
  origin: string,
  path: string,
  headers: Record<string, string>,
  bytes = 40 * 1024 * 1024,
) =>
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
        `content-length: ${bytes}`,
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
