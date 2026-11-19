import { DashboardApi } from "@repo/contracts/dashboard";
import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerResponse } from "effect/http";
import { HttpApi, HttpApiBuilder } from "effect/http-api";
import { adminHandlers } from "./admin";
import { apiKeyHandlers } from "./api-keys";
import { domainHandlers } from "./domains";
import { projectHandlers } from "./projects";
import { DashboardSessionLive, PlatformAdminLive, ProjectAccessLive } from "./session";
import { templateHandlers } from "./templates";
import { workspaceHandlers } from "./workspaces";

/** Every path of the contract, once each, for the preflights CORS answers. */
const contractPaths = () => {
  const paths = new Set<string>();
  HttpApi.reflect(DashboardApi, {
    onEndpoint: ({ endpoint }) => paths.add(endpoint.path),
    onGroup: () => undefined,
  });
  return [...paths].filter((path): path is HttpRouter.PathInput => path.startsWith("/"));
};

/**
 * The dashboard's operations, at the paths `DashboardApi` gives them. `appOrigin` is the
 * only origin a change is accepted from; `billing`, `emailWorkspaceEditing` and `githubSignIn`
 * are what `GET /config` reports. Each path also takes `OPTIONS`, so the CORS middleware
 * these routes are given (`http.ts`) answers the browser's preflight; without a route the
 * request would 404 before reaching it.
 */
export const dashboardRoutes = (options: {
  readonly appOrigin: string;
  readonly billing: boolean;
  readonly emailWorkspaceEditing: boolean;
  readonly githubSignIn: boolean;
}) =>
  Layer.mergeAll(
    HttpApiBuilder.layer(DashboardApi).pipe(
      Layer.provide(
        Layer.mergeAll(
          HttpApiBuilder.group(DashboardApi, "config", (handlers) =>
            Effect.succeed(
              handlers.handle("get", () =>
                Effect.succeed({
                  billing: options.billing,
                  emailWorkspaceEditing: options.emailWorkspaceEditing,
                  githubSignIn: options.githubSignIn,
                }),
              ),
            ),
          ),
          projectHandlers,
          apiKeyHandlers,
          domainHandlers,
          adminHandlers,
          templateHandlers,
          workspaceHandlers,
        ),
      ),
      // provideMerge: building the routes resolves the middleware as well as the handlers.
      Layer.provideMerge(
        Layer.mergeAll(
          DashboardSessionLive(options.appOrigin),
          PlatformAdminLive(options.appOrigin),
          ProjectAccessLive(options.appOrigin),
        ),
      ),
    ),
    HttpRouter.addAll(
      contractPaths().map((path) =>
        HttpRouter.route("OPTIONS", path, HttpServerResponse.empty({ status: 204 })),
      ),
    ),
  );
