import { createQueryKeys } from "@ted-too/query-key-factory";
import { createClient } from "@/integrations/better-auth/client";

export const session = createQueryKeys("session", {
  me: {
    queryFn: async ({ signal }) => {
      const client = createClient();

      const { data, error } = await client.getSession({
        fetchOptions: { signal },
      });

      if (error) {
        console.log({ error });
        throw new Error(error.message);
      }

      return data;
    },
  },
});
