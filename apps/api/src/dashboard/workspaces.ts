import {
  Conflict,
  DashboardApi,
  DashboardMember,
  Invalid,
  NotFound,
  type OperationFailed,
  Unavailable,
  type WorkspaceEntry,
} from "@repo/contracts/dashboard";
import { DB } from "@repo/persistence/db/effect";
import { templatingWorkspace } from "@repo/persistence/db/schema";
import {
  TemplatingBuilderClient,
  type TemplatingBuilderError,
  type TemplatingBuilderRpcClient,
} from "@repo/templating";
import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { operationFailed } from "./failures";

/**
 * The Project's hosted Email Workspace of `kind`, made on first use. Its Git lives in the
 * builder; this is the catalog's row for it.
 */
const projectWorkspace = (kind: "reactEmail") =>
  Effect.gen(function* () {
    const { organizationId } = yield* DashboardMember;
    const db = yield* DB;
    const existing = yield* db.query.templatingWorkspace
      .findFirst({ where: { kind, organizationId, source: "hosted" } })
      .pipe(Effect.catch(operationFailed("Failed to load Email Workspace.")));
    if (existing) {
      return existing;
    }
    const [created] = yield* db
      .insert(templatingWorkspace)
      .values({ kind, organizationId, source: "hosted", updatedAt: new Date() })
      .returning()
      .pipe(Effect.catch(operationFailed("Failed to create Email Workspace.")));
    if (!created) {
      return yield* operationFailed("Failed to create Email Workspace.")(organizationId);
    }
    return created;
  });

/**
 * One call to the template builder about the Project's workspace. Its refusals keep their
 * message; a builder this deployment doesn't have is `Unavailable`.
 */
const withBuilder = <A, E extends { readonly _tag: string }>(
  kind: "reactEmail",
  call: (client: TemplatingBuilderRpcClient, workspaceId: string) => Effect.Effect<A, E>,
) =>
  Effect.gen(function* () {
    const builder = yield* Effect.serviceOption(TemplatingBuilderClient);
    if (builder._tag === "None") {
      return yield* new Unavailable({
        message:
          "Template builder is not configured. Set TEMPLATING_BUILDER_URL and TEMPLATING_BUILDER_SECRET.",
      });
    }
    const workspace = yield* projectWorkspace(kind);
    return yield* call(builder.value, workspace.id).pipe(
      Effect.catch(
        (error): Effect.Effect<never, Conflict | Invalid | NotFound | OperationFailed> => {
          switch (error._tag) {
            case "TemplatingBuilderError": {
              const refusal = error as unknown as TemplatingBuilderError;
              const message = refusal.message;
              switch (refusal.code) {
                case "not_found":
                  return Effect.fail(new NotFound({ message }));
                case "invalid":
                  return Effect.fail(new Invalid({ message }));
                case "busy":
                  return Effect.fail(new Conflict({ message }));
                default:
                  return operationFailed("Template builder request failed.")(error);
              }
            }
            default:
              return operationFailed("Template builder request failed.")(error);
          }
        },
      ),
    );
  });

export const workspaceHandlers = HttpApiBuilder.group(DashboardApi, "workspaces", (handlers) =>
  Effect.succeed(
    handlers
      .handle("get", ({ params }) =>
        Effect.gen(function* () {
          const workspace = yield* projectWorkspace(params.kind);
          // A new workspace's Git is scaffolded on its first read in the builder, so that
          // a first commit never lands on an empty tree.
          yield* withBuilder(params.kind, (client, workspaceId) =>
            client.listFiles({ workspaceId }),
          );
          return {
            createdAt: workspace.createdAt,
            id: workspace.id,
            kind: workspace.kind,
            lastBuildAt: workspace.lastBuildAt,
            lastBuildError: workspace.lastBuildError,
            source: workspace.source,
            updatedAt: workspace.updatedAt,
          };
        }),
      )
      .handle("entries", ({ params }) =>
        Effect.gen(function* () {
          const workspace = yield* projectWorkspace(params.kind);
          const db = yield* DB;
          const entries = yield* db.query.templatingWorkspaceEntry
            .findMany({
              orderBy: { path: "asc" },
              where: { deletedAt: { isNull: true }, workspaceId: workspace.id },
            })
            .pipe(Effect.catch(operationFailed("Failed to list Workspace Entries.")));
          return entries.map((entry): WorkspaceEntry => ({
            artifactCommitSha: entry.artifactCommitSha,
            artifactStorageKey: entry.artifactStorageKey,
            builtAt: entry.builtAt,
            createdAt: entry.createdAt,
            deletedAt: entry.deletedAt,
            id: entry.id,
            path: entry.path,
            pickable: Boolean(!entry.deletedAt && entry.artifactStorageKey),
            updatedAt: entry.updatedAt,
          }));
        }),
      )
      .handle("files", ({ params }) =>
        withBuilder(params.kind, (client, workspaceId) => client.listFiles({ workspaceId })),
      )
      .handle("readFile", ({ params, query }) =>
        withBuilder(params.kind, (client, workspaceId) =>
          client.readFile({ path: query.path, workspaceId }),
        ),
      )
      .handle("commit", ({ params, payload }) =>
        withBuilder(params.kind, (client, workspaceId) =>
          client.commitFiles({
            changes: payload.changes,
            ...(payload.message ? { message: payload.message } : {}),
            workspaceId,
          }),
        ),
      )
      .handle("depsSync", ({ params }) =>
        withBuilder(params.kind, (client, workspaceId) => client.depsSync({ workspaceId })),
      )
      .handle("publish", ({ params }) =>
        withBuilder(params.kind, (client, workspaceId) => client.publish({ workspaceId })),
      )
      .handle("preview", ({ params, payload }) =>
        withBuilder(params.kind, (client, workspaceId) =>
          client.preview({
            entryId: payload.entryId,
            ...(payload.props ? { props: payload.props } : {}),
            ...(payload.subject ? { subjectOverride: payload.subject } : {}),
            workspaceId,
          }),
        ),
      ),
  ),
);
