import { createServerFn } from "@tanstack/react-start";
import { Effect, type Layer } from "effect";
import { z } from "zod";
import {
  attachSandboxProviderForOps,
  createSandboxDomainForOps,
} from "@/lib/admin/sandbox";
import { adminMiddleware } from "@/lib/auth.functions";
import { AppLive, sandboxCloudflareZoneId } from "@/lib/layers";

const runSandboxAdmin = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(AppLive as unknown as Layer.Layer<R>))
  );
const createSandboxBodySchema = z.object({
  providerId: z.string().min(1),
  rootDomain: z.string().min(1),
});

const attachSandboxBodySchema = z.object({
  providerId: z.string().min(1),
  sandboxDomainId: z.string().min(1),
});

/** Admin: create a Sandbox Domain root + first managed Provider identity. */
export const createSandboxDomainFn = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(createSandboxBodySchema)
  .handler(async ({ data }) =>
    runSandboxAdmin(
      createSandboxDomainForOps({
        cloudflareZoneId: sandboxCloudflareZoneId,
        providerId: data.providerId,
        rootDomain: data.rootDomain,
      })
    )
  );

/** Admin: attach another managed Provider to an existing Sandbox Domain. */
export const attachSandboxProviderFn = createServerFn({ method: "POST" })
  .middleware([adminMiddleware])
  .validator(attachSandboxBodySchema)
  .handler(async ({ data }) =>
    runSandboxAdmin(
      attachSandboxProviderForOps({
        providerId: data.providerId,
        sandboxDomainId: data.sandboxDomainId,
      })
    )
  );
