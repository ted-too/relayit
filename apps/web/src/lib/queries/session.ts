import type { QueryClient } from "@tanstack/react-query";
import * as q from "@ted-too/query-key-factory/query";
import { authClient } from "@/lib/auth-client";
import { dashboard } from "@/lib/dashboard";

/** The api answered that nobody is signed in, as opposed to not answering. */
class SignedOut extends Error {}

export const session = q.createQueryKeys("session", {
  me: q.static({
    queryFn: async () => {
      const { data, error } = await authClient.getSession();
      if (error) {
        return Promise.reject(error);
      }
      if (!data) {
        return Promise.reject(new SignedOut("No session found"));
      }
      return data;
    },
  }),
});

/**
 * The session, or null when nobody is signed in. An api that can't be reached or fails
 * rejects instead, so the page shows an error with a retry rather than sending someone who
 * is signed in to sign in again.
 */
export const fetchSessionOrNull = (queryClient: QueryClient) =>
  queryClient
    .fetchQuery(session.me)
    .catch((error: unknown) => (error instanceof SignedOut ? null : Promise.reject(error)));

/** What the deployment offers: billing, GitHub sign-in. Asked before sign-in. */
export const config = q.createQueryKeys("config", {
  get: q.static({
    queryFn: () => dashboard((client) => client.config.get()),
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
