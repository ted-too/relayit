import { createServerFn } from "@tanstack/react-start";
import { Effect, type Layer } from "effect";
import {
  createPlatformProviderBodySchema,
  platformProviderIdSchema,
  updatePlatformProviderBodySchema,
} from "@/lib/admin/provider-schemas";
import {
  createPlatformProvider,
  deletePlatformProvider,
  listPlatformProviders,
  setDefaultPlatformProvider,
  updatePlatformProvider,
} from "@/lib/admin/providers";
import { adminMiddleware } from "@/lib/auth.functions";
import { AppLive } from "@/lib/layers";

const runAdmin = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(AppLive as unknown as Layer.Layer<R>))
  );

export const listPlatformProvidersFn = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async () => runAdmin(listPlatformProviders));

export const createPlatformProviderFn = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(createPlatformProviderBodySchema)
  .handler(async ({ data }) => runAdmin(createPlatformProvider(data)));

export const updatePlatformProviderFn = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(updatePlatformProviderBodySchema)
  .handler(async ({ data }) => runAdmin(updatePlatformProvider(data)));

export const setDefaultPlatformProviderFn = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(platformProviderIdSchema)
  .handler(async ({ data }) =>
    runAdmin(setDefaultPlatformProvider(data.providerId))
  );

export const deletePlatformProviderFn = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(platformProviderIdSchema)
  .handler(async ({ data }) =>
    runAdmin(deletePlatformProvider(data.providerId))
  );
