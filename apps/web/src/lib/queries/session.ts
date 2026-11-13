import * as q from "@ted-too/query-key-factory/query";
import { authClient } from "@/lib/auth-client";
import { dashboard } from "@/lib/dashboard";

export const session = q.createQueryKeys("session", {
  me: q.static({
    queryFn: async () => {
      const { data, error } = await authClient.getSession();
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

/** What the deployment offers: billing, GitHub sign-in. Asked before sign-in. */
export const config = q.createQueryKeys("config", {
  get: q.static({
    queryFn: () => dashboard((client) => client.dashboardConfig.get()),
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
