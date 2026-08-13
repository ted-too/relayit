import * as q from "@ted-too/query-key-factory/query";
import { authClient } from "@/lib/auth-client";
import {
  listCustomDomainsFn,
  listProjectProvidersFn,
} from "@/lib/domains/custom-domain.functions";
import { listApiKeysFn } from "@/lib/projects/api-key.functions";
import {
  getTemplateFn,
  getWorkspaceFn,
  listTemplatesFn,
  listWorkspaceEntriesFn,
  listWorkspaceFilesFn,
} from "@/lib/templating/template.functions";

export const organizations = q.createQueryKeys("organizations", {
  list: q.static({
    queryFn: async ({ signal }) => {
      const { data, error } = await authClient.organization.list({
        fetchOptions: { signal },
      });

      if (error) {
        return Promise.reject(error);
      }

      return data;
    },
  }),
  bySlug: q.dynamic((slug: string) => ({
    queryKey: [slug],
    queryFn: async ({ signal }) => {
      const { data, error } = await authClient.organization.getFullOrganization(
        {
          query: { organizationSlug: slug },
          fetchOptions: { signal },
        }
      );

      if (error) {
        return Promise.reject(error);
      }

      return data;
    },
    listApiKeys: q.static({
      queryFn: async () => await listApiKeysFn({ data: { orgSlug: slug } }),
    }),
    listDomains: q.static({
      queryFn: async () =>
        await listCustomDomainsFn({ data: { orgSlug: slug } }),
    }),
    listProviders: q.static({
      queryFn: async () =>
        await listProjectProvidersFn({ data: { orgSlug: slug } }),
    }),
    listTemplates: q.static({
      queryFn: async () => await listTemplatesFn({ data: { orgSlug: slug } }),
    }),
    template: q.dynamic((templateId: string) => ({
      queryKey: [templateId],
      queryFn: async () =>
        await getTemplateFn({
          data: { orgSlug: slug, templateId },
        }),
    })),
    workspace: q.dynamic((kind: "reactEmail") => ({
      queryKey: [kind],
      queryFn: async () =>
        await getWorkspaceFn({
          data: { kind, orgSlug: slug },
        }),
      entries: q.static({
        queryFn: async () =>
          await listWorkspaceEntriesFn({
            data: { kind, orgSlug: slug },
          }),
      }),
      files: q.static({
        queryFn: async () =>
          await listWorkspaceFilesFn({
            data: { kind, orgSlug: slug },
          }),
      }),
    })),
  })),
});
