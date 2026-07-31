import * as q from "@ted-too/query-key-factory/query";
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
  }),
});
