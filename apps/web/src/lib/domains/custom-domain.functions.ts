import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { Effect, type Layer } from "effect";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { sessionMiddleware } from "@/lib/auth.functions";
import {
  createCustomDomainForProject,
  deleteCustomDomainForProject,
  pauseCustomDomainForProject,
  unpauseCustomDomainForProject,
} from "@/lib/domains/custom-domain";
import { listCustomDomainsForProject } from "@/lib/domains/list";
import { listProvidersForProject } from "@/lib/domains/providers";
import {
  createCustomDomainInputSchema,
  customDomainIdInputSchema,
  listCustomDomainsInputSchema,
  listProjectProvidersInputSchema,
} from "@/lib/domains/schemas";
import { refreshCustomDomainForProject } from "@/lib/domains/verify";
import { AppLive } from "@/lib/layers";
import { requireOrganizationBySlug } from "@/lib/projects/org";

const runDomain = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.runPromise(
    effect.pipe(Effect.provide(AppLive as unknown as Layer.Layer<R>))
  );

const pauseBodySchema = customDomainIdInputSchema.extend({
  reason: z.enum(["bad_reputation", "manual_admin_pause"]),
});

const assertIntegrationPermission = async (input: {
  readonly organizationId: string;
  readonly permission: "create" | "read" | "update" | "delete";
}) => {
  const headers = getRequestHeaders();
  const allowed = await auth.api.hasPermission({
    body: {
      organizationId: input.organizationId,
      permissions: { integration: [input.permission] },
    },
    headers,
  });

  if (!allowed) {
    throw new Error("You do not have permission to manage domains");
  }
};

export const listCustomDomainsFn = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .validator(listCustomDomainsInputSchema)
  .handler(async ({ data }) => {
    const org = await runDomain(requireOrganizationBySlug(data.orgSlug));
    await assertIntegrationPermission({
      organizationId: org.id,
      permission: "read",
    });
    return runDomain(listCustomDomainsForProject({ organizationId: org.id }));
  });

export const listProjectProvidersFn = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .validator(listProjectProvidersInputSchema)
  .handler(async ({ data }) => {
    const org = await runDomain(requireOrganizationBySlug(data.orgSlug));
    await assertIntegrationPermission({
      organizationId: org.id,
      permission: "read",
    });
    return runDomain(listProvidersForProject(org.id));
  });

/** Project member: create or claim a Custom Domain; returns list projection. */
export const createCustomDomainFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(createCustomDomainInputSchema)
  .handler(async ({ data }) => {
    const org = await runDomain(requireOrganizationBySlug(data.orgSlug));
    await assertIntegrationPermission({
      organizationId: org.id,
      permission: "create",
    });
    return runDomain(
      createCustomDomainForProject({
        fqdn: data.fqdn,
        organizationId: org.id,
        providerId: data.providerId,
      })
    );
  });

export const refreshCustomDomainFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(customDomainIdInputSchema)
  .handler(async ({ data }) => {
    const org = await runDomain(requireOrganizationBySlug(data.orgSlug));
    await assertIntegrationPermission({
      organizationId: org.id,
      permission: "create",
    });
    return runDomain(
      refreshCustomDomainForProject({
        customDomainId: data.customDomainId,
        organizationId: org.id,
      })
    );
  });

export const deleteCustomDomainFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(customDomainIdInputSchema)
  .handler(async ({ data }) => {
    const org = await runDomain(requireOrganizationBySlug(data.orgSlug));
    await assertIntegrationPermission({
      organizationId: org.id,
      permission: "delete",
    });
    return runDomain(
      deleteCustomDomainForProject({
        customDomainId: data.customDomainId,
        organizationId: org.id,
      })
    );
  });

export const pauseCustomDomainFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(pauseBodySchema)
  .handler(async ({ data }) => {
    const org = await runDomain(requireOrganizationBySlug(data.orgSlug));
    await assertIntegrationPermission({
      organizationId: org.id,
      permission: "update",
    });
    return runDomain(
      pauseCustomDomainForProject({
        customDomainId: data.customDomainId,
        organizationId: org.id,
        reason: data.reason,
      })
    );
  });

export const unpauseCustomDomainFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(customDomainIdInputSchema)
  .handler(async ({ data }) => {
    const org = await runDomain(requireOrganizationBySlug(data.orgSlug));
    await assertIntegrationPermission({
      organizationId: org.id,
      permission: "update",
    });
    return runDomain(
      unpauseCustomDomainForProject({
        customDomainId: data.customDomainId,
        organizationId: org.id,
      })
    );
  });
