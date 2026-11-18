/**
 * The dashboard's operations: what a signed-in user does to their Projects, as an
 * `HttpApi` the api serves at its root beside the public API, and the dashboard calls with
 * the client derived from it, from its own origin. Every endpoint here but `GET /config`
 * takes the session cookie and nothing else; the api grants the dashboard's origin CORS on
 * every route of this contract and refuses a change from any other origin
 * (`apps/api/src/auth-rule.test.ts`). It is separate from the api's public `Api`, so none
 * of it is in `/docs`: it is the dashboard's, with no stability promise. better-auth's own
 * endpoints (`/auth/*`: sign-in, the session, organizations, members, billing) are called
 * with its client, not through this.
 */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import {
  Conflict,
  Invalid,
  NotFound,
  OperationFailed,
  PlanLimitReached,
  Unavailable,
} from "./errors";
import {
  AdminProject,
  ApiKey,
  ApiKeyInput,
  CommitWorkspaceInput,
  CreatedApiKey,
  CreateDomainInput,
  CreateProjectInput,
  CreateTemplateInput,
  DashboardConfig,
  Domain,
  EntryPreview,
  LinkReactEmailInput,
  PauseDomainInput,
  PreviewEntryInput,
  ProjectRef,
  Template,
  UpdateTemplateInput,
  Workspace,
  WorkspaceCommit,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceFiles,
  WorkspaceKind,
  WorkspacePublish,
} from "./schemas";
import { DashboardSession, PlatformAdmin, ProjectAccess, RequiresPermission } from "./session";

const project = { orgSlug: Schema.String };

/** What any operation on a Project's data can fail with besides access. */
const failures = [NotFound, Conflict, Invalid, OperationFailed];

/** Before sign-in: what the deployment offers. The one endpoint here without a session. */
export class ConfigApi extends HttpApiGroup.make("config").add(
  HttpApiEndpoint.get("get", "/config", { success: DashboardConfig }),
) {}

export class ProjectsApi extends HttpApiGroup.make("projects")
  .add(
    // The slug is derived from the name; better-auth's `afterCreateOrganization` gives the
    // Project its Sandbox Domain.
    HttpApiEndpoint.post("create", "/projects", {
      error: failures,
      payload: CreateProjectInput,
      success: ProjectRef,
    }),
  )
  .middleware(DashboardSession) {}

const apiKey = { ...project, keyId: Schema.String };

export class ApiKeysApi extends HttpApiGroup.make("apiKeys")
  .add(
    HttpApiEndpoint.get("list", "/", {
      error: failures,
      params: project,
      success: Schema.Array(ApiKey),
    }).annotate(RequiresPermission, { apiKey: ["read"] }),
    HttpApiEndpoint.post("create", "/", {
      error: failures,
      params: project,
      payload: ApiKeyInput,
      success: CreatedApiKey,
    }).annotate(RequiresPermission, { apiKey: ["create"] }),
    HttpApiEndpoint.patch("update", "/:keyId", {
      error: failures,
      params: apiKey,
      payload: ApiKeyInput,
      success: ApiKey,
    }).annotate(RequiresPermission, { apiKey: ["update"] }),
    HttpApiEndpoint.delete("delete", "/:keyId", {
      error: failures,
      params: apiKey,
    }).annotate(RequiresPermission, { apiKey: ["delete"] }),
  )
  .middleware(ProjectAccess)
  .prefix("/projects/:orgSlug/api-keys") {}

const domain = { ...project, domainId: Schema.String };

export class DomainsApi extends HttpApiGroup.make("domains")
  .add(
    HttpApiEndpoint.get("list", "/", {
      error: failures,
      params: project,
      success: Schema.Array(Domain),
    }).annotate(RequiresPermission, { domain: ["read"] }),
    // Adds the Domain, or claims one another Project holds.
    HttpApiEndpoint.post("create", "/", {
      error: [...failures, PlanLimitReached],
      params: project,
      payload: CreateDomainInput,
      success: Domain,
    }).annotate(RequiresPermission, { domain: ["create"] }),
    // Checks SES and DNS now rather than on the worker's cadence; for a claim, only its proof.
    HttpApiEndpoint.post("refresh", "/:domainId/refresh", {
      error: failures,
      params: domain,
      success: Domain,
    }).annotate(RequiresPermission, { domain: ["create"] }),
    HttpApiEndpoint.delete("delete", "/:domainId", {
      error: failures,
      params: domain,
    }).annotate(RequiresPermission, { domain: ["delete"] }),
  )
  .middleware(ProjectAccess)
  .prefix("/projects/:orgSlug/domains") {}

/**
 * What only a platform admin does. Pausing a Domain is here and nowhere in a Project's own
 * operations: a Project's members, its owner included, see a pause and cannot lift it. The
 * Domain is named directly, since an admin is a member of none of the Projects they act on.
 */
export class AdminApi extends HttpApiGroup.make("admin")
  .add(
    HttpApiEndpoint.get("listProjects", "/projects", {
      error: failures,
      success: Schema.Array(AdminProject),
    }),
    HttpApiEndpoint.post("pauseDomain", "/domains/:domainId/pause", {
      error: failures,
      params: { domainId: Schema.String },
      payload: PauseDomainInput,
    }),
    HttpApiEndpoint.post("unpauseDomain", "/domains/:domainId/unpause", {
      error: failures,
      params: { domainId: Schema.String },
    }),
  )
  .middleware(PlatformAdmin)
  .prefix("/admin") {}

const template = { ...project, templateId: Schema.String };

export class TemplatesApi extends HttpApiGroup.make("templates")
  .add(
    HttpApiEndpoint.get("list", "/", {
      error: failures,
      params: project,
      success: Schema.Array(Template),
    }).annotate(RequiresPermission, { template: ["read"] }),
    HttpApiEndpoint.get("get", "/:templateId", {
      error: failures,
      params: template,
      success: Template,
    }).annotate(RequiresPermission, { template: ["read"] }),
    HttpApiEndpoint.post("create", "/", {
      error: failures,
      params: project,
      payload: CreateTemplateInput,
      success: Template,
    }).annotate(RequiresPermission, { template: ["create"] }),
    HttpApiEndpoint.patch("update", "/:templateId", {
      error: failures,
      params: template,
      payload: UpdateTemplateInput,
      success: Template,
    }).annotate(RequiresPermission, { template: ["update"] }),
    HttpApiEndpoint.post("archive", "/:templateId/archive", {
      error: failures,
      params: template,
      success: Template,
    }).annotate(RequiresPermission, { template: ["update"] }),
    // Replaces the email variant with one linking a published Workspace Entry.
    HttpApiEndpoint.put("setEmail", "/:templateId/email", {
      error: failures,
      params: template,
      payload: LinkReactEmailInput,
      success: Template,
    }).annotate(RequiresPermission, { template: ["update"] }),
  )
  .middleware(ProjectAccess)
  .prefix("/projects/:orgSlug/templates") {}

const workspace = { ...project, kind: WorkspaceKind };
/** The template builder answers these; without it they are `Unavailable`. */
const builderFailures = [...failures, Unavailable];

/** A Project's Email Workspace, made on first read. Git operations go to the template builder. */
export class WorkspacesApi extends HttpApiGroup.make("workspaces")
  .add(
    HttpApiEndpoint.get("get", "/", {
      error: builderFailures,
      params: workspace,
      success: Workspace,
    }).annotate(RequiresPermission, { template: ["read"] }),
    HttpApiEndpoint.get("listEntries", "/entries", {
      error: failures,
      params: workspace,
      success: Schema.Array(WorkspaceEntry),
    }).annotate(RequiresPermission, { template: ["read"] }),
    // Renders an Entry from the workspace's current source, with sample props.
    HttpApiEndpoint.post("previewEntry", "/entries/:entryId/preview", {
      error: builderFailures,
      params: { ...workspace, entryId: Schema.String },
      payload: PreviewEntryInput,
      success: EntryPreview,
    }).annotate(RequiresPermission, { template: ["read"] }),
    HttpApiEndpoint.get("listFiles", "/files", {
      error: builderFailures,
      params: workspace,
      success: WorkspaceFiles,
    }).annotate(RequiresPermission, { template: ["read"] }),
    // A file's path has slashes, so it is a query parameter rather than a path segment.
    HttpApiEndpoint.get("getFile", "/files/content", {
      error: builderFailures,
      params: workspace,
      query: { path: Schema.NonEmptyString },
      success: WorkspaceFile,
    }).annotate(RequiresPermission, { template: ["read"] }),
    HttpApiEndpoint.post("createCommit", "/commits", {
      error: builderFailures,
      params: workspace,
      payload: CommitWorkspaceInput,
      success: WorkspaceCommit,
    }).annotate(RequiresPermission, { template: ["update"] }),
    HttpApiEndpoint.post("syncDependencies", "/sync-dependencies", {
      error: builderFailures,
      params: workspace,
      success: WorkspaceCommit,
    }).annotate(RequiresPermission, { template: ["update"] }),
    HttpApiEndpoint.post("publish", "/publish", {
      error: builderFailures,
      params: workspace,
      success: WorkspacePublish,
    }).annotate(RequiresPermission, { template: ["update"] }),
  )
  .middleware(ProjectAccess)
  .prefix("/projects/:orgSlug/workspaces/:kind") {}

export class DashboardApi extends HttpApi.make("dashboard")
  .add(ConfigApi)
  .add(ProjectsApi)
  .add(ApiKeysApi)
  .add(DomainsApi)
  .add(AdminApi)
  .add(TemplatesApi)
  .add(WorkspacesApi) {}
