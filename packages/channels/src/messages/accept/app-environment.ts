import type { DatabaseExecutor } from "@repo/persistence/db/effect";
import { organizationAppEnvironment } from "@repo/persistence/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { Effect } from "effect";
import { MessageAcceptPersistenceError } from "./errors";
import type { MessageAttribution } from "./types";

export interface ResolveAppEnvironmentInput {
  readonly attribution: MessageAttribution;
  readonly organizationId: string;
}

export const resolveAppEnvironment = (
  db: DatabaseExecutor,
  input: ResolveAppEnvironmentInput
) =>
  Effect.gen(function* () {
    const app =
      input.attribution.kind === "appEnvironment"
        ? input.attribution.app
        : null;
    const environment =
      input.attribution.kind === "appEnvironment"
        ? input.attribution.environment
        : null;
    const find = () =>
      db
        .select()
        .from(organizationAppEnvironment)
        .where(
          and(
            eq(organizationAppEnvironment.organizationId, input.organizationId),
            app === null
              ? isNull(organizationAppEnvironment.app)
              : eq(organizationAppEnvironment.app, app),
            environment === null
              ? isNull(organizationAppEnvironment.environment)
              : eq(organizationAppEnvironment.environment, environment)
          )
        )
        .limit(1)
        .pipe(
          Effect.map(([record]) => record),
          Effect.mapError(
            (cause) =>
              new MessageAcceptPersistenceError({
                cause,
                operation: "find_app_environment",
                organizationId: input.organizationId,
              })
          )
        );
    const existing = yield* find();
    if (existing) {
      return existing;
    }

    const [created] = yield* db
      .insert(organizationAppEnvironment)
      .values({
        app,
        environment,
        organizationId: input.organizationId,
      })
      .onConflictDoNothing()
      .returning()
      .pipe(
        Effect.mapError(
          (cause) =>
            new MessageAcceptPersistenceError({
              cause,
              operation: "create_app_environment",
              organizationId: input.organizationId,
            })
        )
      );
    if (created) {
      return created;
    }

    const concurrentlyCreated = yield* find();
    if (concurrentlyCreated) {
      return concurrentlyCreated;
    }

    return yield* Effect.die(
      new Error(
        `App Environment insert returned no record for Organization ${input.organizationId}`
      )
    );
  });
