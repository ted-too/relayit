import * as q from "@ted-too/query-key-factory/query";
import { createApiClient } from "@/integrations/api";

export const admin = q.createQueryKeys("admin", {
  listProviders: q.static({
    queryFn: async ({ signal }) => {
      const client = createApiClient();

      const { data, error } = await client.admin.providers.get({
        fetch: { signal },
      });

      if (error) {
        throw new Error(error.value);
      }

      return data;
    },
  }),
});
