import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  attachSandboxProviderForOps,
  createSandboxDomainForOps,
} from "@/lib/admin/sandbox.server";
import { adminMiddleware } from "@/lib/auth.functions";
import { runApp, sandboxCloudflareZoneId } from "@/lib/layers.server";

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
    runApp(
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
    runApp(
      attachSandboxProviderForOps({
        providerId: data.providerId,
        sandboxDomainId: data.sandboxDomainId,
      })
    )
  );
