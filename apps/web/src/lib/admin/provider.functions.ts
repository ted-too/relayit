import { createServerFn } from "@tanstack/react-start";
import { Effect } from "effect";
import {
  createPlatformProviderBodySchema,
  platformProviderIdSchema,
  updatePlatformProviderBodySchema,
} from "@/lib/admin/provider-schemas";
import {
  createPlatformProvider,
  deletePlatformProvider,
  listPlatformProviders,
  PlatformProviderError,
  setDefaultPlatformProvider,
  updatePlatformProvider,
} from "@/lib/admin/providers.server";
import { adminMiddleware } from "@/lib/auth.functions";
import { apiOrigin, runApp, sandboxCloudflare } from "@/lib/layers.server";

const apiOriginOrFail = apiOrigin
  ? Effect.succeed(apiOrigin)
  : new PlatformProviderError({
      code: "failed",
      message: "API origin is not configured.",
    });

export const listPlatformProvidersFn = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async () => runApp(listPlatformProviders));

export const createPlatformProviderFn = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(createPlatformProviderBodySchema)
  .handler(async ({ data }) =>
    runApp(
      Effect.gen(function* () {
        const origin = yield* apiOriginOrFail;
        return yield* createPlatformProvider({
          ...data,
          apiOrigin: origin,
          sandboxCloudflare,
        });
      })
    )
  );

export const updatePlatformProviderFn = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(updatePlatformProviderBodySchema)
  .handler(async ({ data }) =>
    runApp(
      Effect.gen(function* () {
        const origin = yield* apiOriginOrFail;
        return yield* updatePlatformProvider({
          ...data,
          apiOrigin: origin,
        });
      })
    )
  );

export const setDefaultPlatformProviderFn = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(platformProviderIdSchema)
  .handler(async ({ data }) =>
    runApp(setDefaultPlatformProvider(data.providerId))
  );

export const deletePlatformProviderFn = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(platformProviderIdSchema)
  .handler(async ({ data }) =>
    runApp(
      Effect.gen(function* () {
        const origin = yield* apiOriginOrFail;
        return yield* deletePlatformProvider(data.providerId, origin);
      })
    )
  );
