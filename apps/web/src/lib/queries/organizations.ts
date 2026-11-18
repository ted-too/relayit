import * as q from "@ted-too/query-key-factory/query";
import { authClient } from "@/lib/auth-client";
import { dashboard } from "@/lib/dashboard";

const project = (slug: string) => ({ params: { orgSlug: slug } });

export const organizations = q.createQueryKeys("organizations", {
  list: q.static({
    queryFn: async () => {
      const { data, error } = await authClient.organization.list();
      if (error) {
        return Promise.reject(error);
      }
      return data;
    },
  }),
  bySlug: q.dynamic((slug: string) => ({
    queryKey: [slug],
    queryFn: async () => {
      const { data, error } = await authClient.organization.getFullOrganization({
        query: { organizationSlug: slug },
      });
      if (error || !data) {
        return Promise.reject(new Error("No organization found"));
      }
      return data;
    },
    listApiKeys: q.static({
      queryFn: () => dashboard((client) => client.apiKeys.list(project(slug))),
    }),
    listDomains: q.static({
      queryFn: () => dashboard((client) => client.domains.list(project(slug))),
    }),
    listTemplates: q.static({
      queryFn: () => dashboard((client) => client.templates.list(project(slug))),
    }),
    template: q.dynamic((templateId: string) => ({
      queryKey: [templateId],
      queryFn: () =>
        dashboard((client) => client.templates.get({ params: { orgSlug: slug, templateId } })),
    })),
    workspace: q.dynamic((kind: "reactEmail") => ({
      queryKey: [kind],
      queryFn: () =>
        dashboard((client) => client.workspaces.get({ params: { kind, orgSlug: slug } })),
      entries: q.static({
        queryFn: () =>
          dashboard((client) => client.workspaces.entries({ params: { kind, orgSlug: slug } })),
      }),
      files: q.static({
        queryFn: () =>
          dashboard((client) => client.workspaces.files({ params: { kind, orgSlug: slug } })),
      }),
    })),
  })),
});
