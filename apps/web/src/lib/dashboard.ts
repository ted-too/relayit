import { DashboardApi } from "@repo/contracts/dashboard";
import { Effect } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

type DashboardClient = HttpApiClient.ForApi<typeof DashboardApi>;

/**
 * Runs one of the api's dashboard operations from the browser, on the page's own origin
 * so the session cookie goes with it. It rejects with the contract's error, whose message
 * a toast can show; a session that has ended sends the person to sign in.
 */
export const dashboard = <A, E>(operation: (client: DashboardClient) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    HttpApiClient.make(DashboardApi, { baseUrl: window.location.origin }).pipe(
      Effect.flatMap(operation),
      Effect.tapError((error) =>
        Effect.sync(() => {
          if (
            typeof error === "object" &&
            error !== null &&
            "_tag" in error &&
            error._tag === "Unauthenticated"
          ) {
            window.location.assign(
              `/auth/sign-in?redirect=${encodeURIComponent(window.location.pathname)}`,
            );
          }
        }),
      ),
      Effect.provide(FetchHttpClient.layer),
    ),
  );
