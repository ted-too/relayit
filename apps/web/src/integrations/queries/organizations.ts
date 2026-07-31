import * as q from "@ted-too/query-key-factory/query";
import { createApiClient } from "@/integrations/api";
import { createAuthClient } from "@/integrations/better-auth";

export const organizations = q.createQueryKeys("organizations", {
  list: q.static({
    queryFn: async ({ signal }) => {
      const client = createAuthClient();

      const { data, error } = await client.organization.list({
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
      const client = createAuthClient();

      const { data, error } = await client.organization.getFullOrganization({
        query: { organizationSlug: slug },
        fetchOptions: { signal },
      });

      if (error) {
        return Promise.reject(error);
      }

      return data;
    },
    listApiKeys: q.static({
      queryFn: async ({ signal }) => {
        const client = createApiClient();

        const { data, error } = await client
          .projects({ orgSlug: slug })
          .apiKeys.get({ fetch: { signal } });

        if (error) {
          return Promise.reject(error);
        }

        return data;
      },
    }),
    listDomains: q.static({
      queryFn: async ({ signal }) => {
        const client = createApiClient();

        const { data, error } = await client
          .projects({ orgSlug: slug })
          .channels.email.domains.get({ fetch: { signal } });

        if (error) {
          return Promise.reject(error);
        }

        return data;
      },
    }),
    listProviders: q.static({
      queryFn: async ({ signal }) => {
        const client = createApiClient();

        const { data, error } = await client
          .projects({ orgSlug: slug })
          .providers.get({ fetch: { signal } });

        if (error) {
          return Promise.reject(error);
        }

        return data;
      },
    }),
  })),
});
