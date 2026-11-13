import { DashboardApi } from "@repo/contracts/dashboard";
import { Effect, Layer } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { apiKeyHandlers } from "./api-keys";
import { domainHandlers } from "./domains";
import { projectHandlers } from "./projects";
import { DashboardSessionLive, ProjectAccessLive } from "./session";
import { templateHandlers } from "./templates";
import { workspaceHandlers } from "./workspaces";

/**
 * The dashboard's operations under `/api/dashboard`. `appOrigin` is the only origin a
 * change is accepted from; `billing` and `githubSignIn` are what `/config` reports.
 */
export const dashboardRoutes = (options: {
  readonly appOrigin: string;
  readonly billing: boolean;
  readonly githubSignIn: boolean;
}) =>
  HttpApiBuilder.layer(DashboardApi).pipe(
    Layer.provide(
      Layer.mergeAll(
        HttpApiBuilder.group(DashboardApi, "dashboardConfig", (handlers) =>
          Effect.succeed(
            handlers.handle("get", () =>
              Effect.succeed({ billing: options.billing, githubSignIn: options.githubSignIn }),
            ),
          ),
        ),
        projectHandlers,
        apiKeyHandlers,
        domainHandlers,
        templateHandlers,
        workspaceHandlers,
      ),
    ),
    // provideMerge: building the routes resolves the middleware as well as the handlers.
    Layer.provideMerge(
      Layer.mergeAll(DashboardSessionLive(options.appOrigin), ProjectAccessLive(options.appOrigin)),
    ),
  );
