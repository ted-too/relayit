import * as q from "@ted-too/query-key-factory/query";
import { getSession } from "@/lib/auth.functions";
import { authClient } from "@/lib/auth-client";

export const session = q.createQueryKeys("session", {
  me: q.static({
    queryFn: async () => {
      const session = await getSession();

      if (!session) {
        return Promise.reject(new Error("No session found"));
      }

      return session;
    },
  }),
});

export const subscriptions = q.createQueryKeys("subscriptions", {
  list: q.static({
    queryFn: async () => {
      const { data, error } = await authClient.subscription.list({
        query: {
          customerType: "user",
        },
      });

      if (error) {
        return Promise.reject(error);
      }

      return data;
    },
  }),
  active: q.static({
    dependsOn: {
      session: session.me,
    },
    queryFn: async (_, { session }) => {
      const { data, error } = await authClient.subscription.list({
        query: {
          referenceId: session.user.id,
          customerType: "user",
        },
      });

      if (error) {
        return Promise.reject(error);
      }

      return data;
    },
  }),
});
