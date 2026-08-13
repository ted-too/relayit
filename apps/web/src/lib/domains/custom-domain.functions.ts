import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { z } from "zod";
import { sessionMiddleware } from "@/lib/auth.functions";
import { auth } from "@/lib/auth.server";
import {
  createCustomDomainForProject,
  deleteCustomDomainForProject,
  pauseCustomDomainForProject,
  unpauseCustomDomainForProject,
} from "@/lib/domains/custom-domain.server";
import { listCustomDomainsForProject } from "@/lib/domains/list.server";
import { listProvidersForProject } from "@/lib/domains/providers.server";
import {
  createCustomDomainInputSchema,
  customDomainIdInputSchema,
  listCustomDomainsInputSchema,
  listProjectProvidersInputSchema,
} from "@/lib/domains/schemas";
import { refreshCustomDomainForProject } from "@/lib/domains/verify.server";
import { runApp } from "@/lib/layers.server";
import { requireOrganizationBySlug } from "@/lib/projects/org.server";

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
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertIntegrationPermission({
      organizationId: org.id,
      permission: "read",
    });
    return runApp(listCustomDomainsForProject({ organizationId: org.id }));
  });

export const listProjectProvidersFn = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .validator(listProjectProvidersInputSchema)
  .handler(async ({ data }) => {
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertIntegrationPermission({
      organizationId: org.id,
      permission: "read",
    });
    return runApp(listProvidersForProject(org.id));
  });

/** Project member: create or claim a Custom Domain; returns list projection. */
export const createCustomDomainFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(createCustomDomainInputSchema)
  .handler(async ({ data }) => {
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertIntegrationPermission({
      organizationId: org.id,
      permission: "create",
    });
    return runApp(
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
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertIntegrationPermission({
      organizationId: org.id,
      permission: "create",
    });
    return runApp(
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
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertIntegrationPermission({
      organizationId: org.id,
      permission: "delete",
    });
    return runApp(
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
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertIntegrationPermission({
      organizationId: org.id,
      permission: "update",
    });
    return runApp(
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
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertIntegrationPermission({
      organizationId: org.id,
      permission: "update",
    });
    return runApp(
      unpauseCustomDomainForProject({
        customDomainId: data.customDomainId,
        organizationId: org.id,
      })
    );
  });
