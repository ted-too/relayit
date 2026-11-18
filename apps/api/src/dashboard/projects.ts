import { DashboardApi, DashboardUser, projectSlugFromName } from "@repo/contracts/dashboard";
import { DB } from "@repo/persistence/db/effect";
import { organization } from "@repo/persistence/db/schema";
import { generateDbSlug } from "@repo/persistence/db/slug";
import { Effect } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";
import { ApiAuth } from "../lib/auth";
import { callAuth, operationFailed } from "./failures";

export const projectHandlers = HttpApiBuilder.group(DashboardApi, "projects", (handlers) =>
  Effect.gen(function* () {
    const { auth } = yield* ApiAuth;
    return handlers.handle("create", ({ payload }) =>
      Effect.gen(function* () {
        const user = yield* DashboardUser;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const db = yield* DB;
        // `projectSlugFromName` always passes `ProjectSlug`, and leaves room for the `-2`,
        // `-3`… that makes it unique.
        const slug = yield* generateDbSlug(
          db,
          organization,
          projectSlugFromName(payload.name),
        ).pipe(Effect.catch(operationFailed("Failed to create Project.")));
        const created = yield* callAuth("Failed to create Project.", () =>
          auth.api.createOrganization({
            body: {
              keepCurrentActiveOrganization: false,
              name: payload.name,
              slug,
              userId: user.id,
            },
            headers: new Headers(request.headers),
          }),
        );
        if (!created) {
          return yield* operationFailed("Failed to create Project.")(slug);
        }
        return { id: created.id, name: created.name, slug: created.slug };
      }),
    );
  }),
);
