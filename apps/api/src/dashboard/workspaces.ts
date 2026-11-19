import {
  Conflict,
  DashboardApi,
  DashboardMember,
  EmailWorkspacesFrozen,
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
import { Context, Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";
import { operationFailed } from "./failures";

/**
 * Whether the deployment lets Email Workspaces be edited (`EMAIL_WORKSPACE_EDITING`). Off,
 * they are frozen: what would store, install, build, render or seal workspace source, or
 * link a Template to an Entry it does not already link, is refused before the builder hears
 * of it, and only reads of a workspace that already exists go through.
 */
export class EmailWorkspaceEditing extends Context.Service<EmailWorkspaceEditing, boolean>()(
  "EmailWorkspaceEditing",
) {}

const frozenRefuses = <A, E, R>(operation: Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    if (!(yield* EmailWorkspaceEditing)) {
      return yield* new EmailWorkspacesFrozen({
        message: "Email Workspaces are frozen on this deployment.",
      });
    }
    return yield* operation;
  });

/**
 * The Project's hosted Email Workspace of `kind`, made on first use. Its Git lives in the
 * builder; this is the catalog's row for it. Frozen, none is made, so a Project without one
 * never reaches the builder.
 */
const projectWorkspace = (kind: "reactEmail") =>
  Effect.gen(function* () {
    const { organizationId } = yield* DashboardMember;
    const db = yield* DB;
    const find = db.query.templatingWorkspace
      .findFirst({ where: { kind, organizationId, source: "hosted" } })
      .pipe(Effect.catch(operationFailed("Failed to load Email Workspace.")));
    const existing = yield* find;
    if (existing) {
      return existing;
    }
    if (!(yield* EmailWorkspaceEditing)) {
      return yield* new EmailWorkspacesFrozen({
        message: "Email Workspaces are frozen on this deployment.",
      });
    }
    // A page's first reads arrive together and all find no row. The unique index lets one
    // insert win; the others do nothing, and every one reads the winner's row.
    yield* db
      .insert(templatingWorkspace)
      .values({ kind, organizationId, source: "hosted", updatedAt: new Date() })
      .onConflictDoNothing()
      .pipe(Effect.catch(operationFailed("Failed to create Email Workspace.")));
    const created = yield* find;
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
      // The operator needs the variables; the customer only that the feature is off here.
      yield* Effect.logWarning(
        "Email Workspaces need TEMPLATING_BUILDER_URL and TEMPLATING_BUILDER_SECRET on the api",
      );
      return yield* new Unavailable({
        message: "Email Workspaces aren't available on this deployment.",
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
                  // A `detail` is the workspace's own install, bundle or render failing:
                  // the Project's to read and fix, not a failure of ours.
                  // A tool that failed without a word gives the Project nothing to act on.
                  return refusal.detail === undefined || refusal.detail === ""
                    ? operationFailed("Template builder request failed.")(error)
                    : Effect.fail(new Invalid({ detail: refusal.detail, message }));
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
      .handle("listEntries", ({ params }) =>
        Effect.gen(function* () {
          // Frozen, a Project with no workspace has no Entries, rather than a refusal the
          // Template pages would have to read around.
          const workspace = yield* projectWorkspace(params.kind).pipe(
            Effect.catchTags({ EmailWorkspacesFrozen: () => Effect.undefined }),
          );
          if (!workspace) {
            return [];
          }
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
      .handle("listFiles", ({ params }) =>
        withBuilder(params.kind, (client, workspaceId) => client.listFiles({ workspaceId })),
      )
      .handle("getFile", ({ params, query }) =>
        withBuilder(params.kind, (client, workspaceId) =>
          client.readFile({ path: query.path, workspaceId }),
        ),
      )
      .handle("createCommit", ({ params, payload }) =>
        frozenRefuses(
          withBuilder(params.kind, (client, workspaceId) =>
            client.commitFiles({
              changes: payload.changes,
              ...(payload.message ? { message: payload.message } : {}),
              workspaceId,
            }),
          ),
        ),
      )
      .handle("syncDependencies", ({ params }) =>
        frozenRefuses(
          withBuilder(params.kind, (client, workspaceId) => client.depsSync({ workspaceId })),
        ),
      )
      .handle("publish", ({ params }) =>
        frozenRefuses(
          withBuilder(params.kind, (client, workspaceId) => client.publish({ workspaceId })),
        ),
      )
      // A preview bundles and renders the workspace's current source.
      .handle("previewEntry", ({ params, payload }) =>
        frozenRefuses(
          withBuilder(params.kind, (client, workspaceId) =>
            client.preview({
              entryId: params.entryId,
              ...(payload.props ? { props: payload.props } : {}),
              ...(payload.subject ? { subjectOverride: payload.subject } : {}),
              workspaceId,
            }),
          ),
        ),
      ),
  ),
);
