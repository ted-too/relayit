import { createQueryKeys } from "@ted-too/query-key-factory";
import { createClient } from "@/integrations/api/client";

export const organizations = createQueryKeys("organizations", {
  listIntegrations: (slug: string) => ({
    queryKey: [slug],
    queryFn: async ({ signal }) => {
      const client = createClient();

      const { data, error } = await client.organization
        .bySlug({ slug })
        .integrations.get({ fetch: { signal } });

      if (error) {
        throw new Error(error.value);
      }

      return data;
    },
  }),
});
