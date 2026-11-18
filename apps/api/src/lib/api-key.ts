import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest } from "effect/http";
import {
  ApiKeyAuth,
  CurrentProject,
  InternalServerError,
  InvalidApiKey,
  LegacyApiKeyAuth,
  LegacyProject,
  LegacyProjectNotFound,
  LegacyUnauthorized,
} from "../api";
import { ApiAuth } from "./auth";

const invalidApiKey = new InvalidApiKey({ code: "invalid_api_key", message: "Invalid API key" });

/** Request validation has already refused a request without `x-api-key`. */
export const ApiKeyAuthLive = Layer.effect(
  ApiKeyAuth,
  Effect.gen(function* () {
    const { auth, db } = yield* ApiAuth;
    return ApiKeyAuth.of((httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const result = yield* Effect.promise(() =>
          auth.api.verifyApiKey({
            body: { configId: "org-keys", key: request.headers["x-api-key"] ?? "" },
            headers: new Headers(request.headers),
          }),
        );
        if (!(result.valid && result.key)) {
          return yield* invalidApiKey;
        }
        const referenceId = result.key.referenceId;
        const organization = yield* Effect.promise(() =>
          db.query.organization.findFirst({ columns: { id: true }, where: { id: referenceId } }),
        );
        if (!organization) {
          return yield* invalidApiKey;
        }
        const owner = yield* Effect.promise(() =>
          db.query.member.findFirst({
            columns: { userId: true },
            where: { organizationId: organization.id, role: "owner" },
          }),
        );
        if (!owner) {
          return yield* new InternalServerError({
            code: "internal_server_error",
            message: "Project owner not found",
          });
        }
        return yield* Effect.provideService(httpEffect, CurrentProject, {
          apiKeyId: result.key.id,
          organizationId: organization.id,
          organizationOwnerUserId: owner.userId,
        });
      }),
    );
  }),
);

/**
 * The legacy endpoints answer 401 for a missing or unknown key, with better-auth's reason
 * when it gives one, and 404 for a key of another Project than the one in the path.
 */
export const LegacyApiKeyAuthLive = Layer.effect(
  LegacyApiKeyAuth,
  Effect.gen(function* () {
    const { auth, db } = yield* ApiAuth;
    return LegacyApiKeyAuth.of((httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const { project } = yield* HttpRouter.params;
        const key = request.headers["x-api-key"];
        if (!key) {
          return yield* new LegacyUnauthorized({ details: [], message: "Unauthorized" });
        }
        const result = yield* Effect.promise(() =>
          auth.api.verifyApiKey({
            body: { configId: "org-keys", key },
            headers: new Headers(request.headers),
          }),
        );
        if (!(result.valid && result.key)) {
          // better-auth's reason, e.g. "Invalid API key."; typed as possibly its error object.
          const reason = result.error?.message;
          return yield* new LegacyUnauthorized({
            details: [],
            message: (typeof reason === "string" ? reason : reason?.message) ?? "Unauthorized",
          });
        }
        const referenceId = result.key.referenceId;
        const organization = yield* Effect.promise(() =>
          db.query.organization.findFirst({
            columns: { id: true, slug: true },
            where: { id: referenceId },
          }),
        );
        if (!organization) {
          return yield* new LegacyUnauthorized({ details: [], message: "Unauthorized" });
        }
        if (organization.slug !== project) {
          return yield* new LegacyProjectNotFound({ details: [], message: "Project not found" });
        }
        return yield* Effect.provideService(httpEffect, LegacyProject, { id: organization.id });
      }),
    );
  }),
);
