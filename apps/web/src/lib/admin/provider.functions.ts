import { createServerFn } from "@tanstack/react-start";
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
} from "@/lib/admin/providers.server";
import { adminMiddleware } from "@/lib/auth.functions";
import { runApp, sandboxCloudflare } from "@/lib/layers.server";

export const listPlatformProvidersFn = createServerFn({ method: "GET" })
  .middleware([adminMiddleware])
  .handler(async () => runApp(listPlatformProviders));

export const createPlatformProviderFn = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(createPlatformProviderBodySchema)
  .handler(async ({ data }) =>
    runApp(
      createPlatformProvider({
        ...data,
        sandboxCloudflare,
      })
    )
  );

export const updatePlatformProviderFn = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(updatePlatformProviderBodySchema)
  .handler(async ({ data }) => runApp(updatePlatformProvider(data)));

export const setDefaultPlatformProviderFn = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(platformProviderIdSchema)
  .handler(async ({ data }) =>
    runApp(setDefaultPlatformProvider(data.providerId))
  );

export const deletePlatformProviderFn = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(platformProviderIdSchema)
  .handler(async ({ data }) => runApp(deletePlatformProvider(data.providerId)));
