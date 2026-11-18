import { type ApiKey, DashboardApi, DashboardMember, NotFound } from "@repo/contracts/dashboard";
import { logEffectFailure } from "@repo/logging";
import { DB } from "@repo/persistence/db/effect";
import { apikey } from "@repo/persistence/db/schema";
import { and, eq } from "drizzle-orm";
import { Effect } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { ApiAuth } from "../lib/auth";
import { callAuth, operationFailed } from "./failures";

/** Project keys; a user's own keys are `user-keys`. */
const CONFIG_ID = "org-keys";

interface KeyMetadata {
  readonly createdBy?: string;
  readonly end?: string | null;
}

interface BetterAuthKey {
  readonly createdAt: Date;
  readonly expiresAt?: Date | null;
  readonly id: string;
  readonly lastRequest?: Date | null;
  readonly metadata?: unknown;
  readonly name?: string | null;
  readonly start?: string | null;
}

/** Who made a key, as the dashboard shows them. */
const loadCreator = (userId: string | undefined) =>
  Effect.gen(function* () {
    if (!userId) {
      return null;
    }
    const db = yield* DB;
    const creator = yield* db.query.user
      .findFirst({
        columns: { email: true, image: true, name: true },
        where: { id: userId },
      })
      .pipe(Effect.catch(operationFailed("Failed to load API key.")));
    return creator ?? null;
  });

/**
 * A key as the dashboard lists it: its last characters and who made it, both kept in its
 * metadata.
 */
const toApiKey = (
  key: BetterAuthKey,
  metadata: KeyMetadata | null,
  createdBy: ApiKey["createdBy"],
) =>
  ({
    createdAt: key.createdAt,
    createdBy,
    end: metadata?.end ?? null,
    expiresAt: key.expiresAt ?? null,
    id: key.id,
    lastRequest: key.lastRequest ?? null,
    name: key.name ?? null,
    start: key.start ?? null,
  }) satisfies ApiKey;

const describeKey = (key: BetterAuthKey) =>
  Effect.gen(function* () {
    const metadata =
      key.metadata && typeof key.metadata === "object" ? (key.metadata as KeyMetadata) : null;
    return toApiKey(key, metadata, yield* loadCreator(metadata?.createdBy));
  });

/** better-auth wants a lifetime, not an expiry. */
const expiresIn = (expiresAt: Date | undefined) =>
  expiresAt === undefined ? undefined : Math.floor((expiresAt.getTime() - Date.now()) / 1000);

export const apiKeyHandlers = HttpApiBuilder.group(DashboardApi, "apiKeys", (handlers) =>
  Effect.gen(function* () {
    const { auth } = yield* ApiAuth;
    // better-auth checks the caller's session on these as well, from the same cookie.
    const requestHeaders = HttpServerRequest.HttpServerRequest.pipe(
      Effect.map((request) => new Headers(request.headers)),
    );
    return handlers
      .handle("list", () =>
        Effect.gen(function* () {
          const { organizationId } = yield* DashboardMember;
          const headers = yield* requestHeaders;
          const listed = yield* callAuth("Failed to list API keys.", () =>
            auth.api.listApiKeys({ headers, query: { organizationId } }),
          );
          return yield* Effect.forEach(listed.apiKeys, describeKey, { concurrency: "unbounded" });
        }),
      )
      .handle("create", ({ payload }) =>
        Effect.gen(function* () {
          const { organizationId, userId } = yield* DashboardMember;
          const headers = yield* requestHeaders;
          // Nothing may fail once the key exists: a failed response would leave a live key
          // whose secret nobody was shown. So the creator is read first, and the follow-up
          // below is only logged when it fails.
          const createdBy = yield* loadCreator(userId);
          const { key, ...created } = yield* callAuth("Failed to create API key.", () =>
            auth.api.createApiKey({
              body: {
                configId: CONFIG_ID,
                expiresIn: expiresIn(payload.expiresAt),
                metadata: { createdBy: userId },
                name: payload.name,
                organizationId,
              },
              headers,
            }),
          );
          // better-auth generates the key, so its last characters are known only now.
          const metadata = { createdBy: userId, end: key.slice(-6) };
          const stored = yield* Effect.tryPromise(() =>
            auth.api.updateApiKey({
              body: { configId: CONFIG_ID, keyId: created.id, metadata },
              headers,
            }),
          ).pipe(
            Effect.as(metadata),
            Effect.catchCause((cause) =>
              logEffectFailure("API key created without its last characters")(cause).pipe(
                Effect.as({ createdBy: userId }),
              ),
            ),
          );
          return { apiKey: toApiKey(created, stored, createdBy), key };
        }),
      )
      .handle("update", ({ params, payload }) =>
        Effect.gen(function* () {
          const { organizationId } = yield* DashboardMember;
          const db = yield* DB;
          // The key must be this Project's; better-auth would check the user may manage
          // the key's own Project, not that it is the one in the path.
          const [owned] = yield* db
            .select({ id: apikey.id })
            .from(apikey)
            .where(and(eq(apikey.id, params.keyId), eq(apikey.referenceId, organizationId)))
            .pipe(Effect.catch(operationFailed("Failed to update API key.")));
          if (!owned) {
            return yield* new NotFound({ message: "API key not found." });
          }
          const headers = yield* requestHeaders;
          const updated = yield* callAuth("Failed to update API key.", () =>
            auth.api.updateApiKey({
              body: {
                configId: CONFIG_ID,
                expiresIn: expiresIn(payload.expiresAt),
                keyId: owned.id,
                name: payload.name,
              },
              headers,
            }),
          );
          return yield* describeKey(updated);
        }),
      )
      .handle("delete", ({ params }) =>
        Effect.gen(function* () {
          const { organizationId } = yield* DashboardMember;
          const db = yield* DB;
          // As for update: the key must be the Project's in the path.
          const [owned] = yield* db
            .select({ id: apikey.id })
            .from(apikey)
            .where(and(eq(apikey.id, params.keyId), eq(apikey.referenceId, organizationId)))
            .pipe(Effect.catch(operationFailed("Failed to delete API key.")));
          if (!owned) {
            return yield* new NotFound({ message: "API key not found." });
          }
          const headers = yield* requestHeaders;
          yield* callAuth("Failed to delete API key.", () =>
            auth.api.deleteApiKey({ body: { configId: CONFIG_ID, keyId: owned.id }, headers }),
          );
        }),
      );
  }),
);
