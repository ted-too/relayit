import * as q from "@ted-too/query-key-factory/query";
import { createApiClient } from "@/integrations/api";
import { createAuthClient } from "@/integrations/better-auth";

export const session = q.createQueryKeys("session", {
  me: q.static({
    queryFn: async ({ signal }) => {
      const client = createAuthClient();

      const { data, error } = await client.getSession({
        fetchOptions: { signal },
      });

      if (error) {
        return Promise.reject(error);
      }

      if (!data) {
        return Promise.reject(new Error("No session found"));
      }

      return data;
    },
    organizations: q.static({
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

          const { data, error } = await client.organization.getFullOrganization(
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
          queryFn: async ({ signal }) => {
            const client = createApiClient();

            const { data, error } = await client.organization
              .bySlug({ slug })
              .apiKeys.get({ fetch: { signal } });

            if (error) {
              return Promise.reject(error);
            }

            return data;
          },
        }),
        listIntegrations: q.static({
          queryFn: async ({ signal }) => {
            const client = createApiClient();

            const { data, error } = await client.organization
              .bySlug({ slug })
              .integrations.get({ fetch: { signal } });

            if (error) {
              throw new Error(error.value);
            }

            return data;
          },
        }),
      })),
    }),
  }),
});
