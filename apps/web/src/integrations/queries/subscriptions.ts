import * as q from "@ted-too/query-key-factory/query";
import { createAuthClient } from "@/integrations/better-auth";

export const subscriptions = q.createQueryKeys("subscriptions", {
  active: q.dynamic((userId: string) => ({
    queryFn: async ({ signal }) => {
      const client = createAuthClient();

      const { data, error } = await client.subscription.list({
        query: {
          referenceId: userId,
          customerType: "user",
        },
        fetchOptions: { signal },
      });

      if (error) {
        return Promise.reject(error);
      }

      return data;
    },
  })),
});
