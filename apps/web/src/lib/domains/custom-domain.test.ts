import { describe, expect, test } from "bun:test";
import { DB } from "@repo/persistence/db/effect";
import { Effect, Layer } from "effect";
import { pauseCustomDomainForProject } from "./custom-domain.server";

describe("pauseCustomDomainForProject", () => {
  test("maps missing Project link to not_found", () => {
    const db = {
      query: {
        organizationDomain: {
          findFirst: () => Effect.succeed(null),
        },
      },
    };

    return Effect.runPromise(
      pauseCustomDomainForProject({
        customDomainId: "dom_1",
        organizationId: "org_1",
        reason: "manual_admin_pause",
      }).pipe(
        Effect.provide(Layer.succeed(DB, db as never)),
        Effect.flip,
        Effect.map((error) => {
          expect(error).toMatchObject({
            code: "not_found",
          });
          return error;
        }),
      ),
    );
  });
});
