/**
 * The dashboard's operations: what a signed-in user does to their Projects, as an
 * `HttpApi` the api serves under `/api/dashboard` and the dashboard calls with the client
 * derived from it. Separate from the api's public `Api`, so none of it is in `/docs`.
 * better-auth's own endpoints (`/api/auth/*`: sign-in, the session, organizations,
 * members, deleting an API key, billing) are called with its client, not through this.
 */
import { Schema } from "effect";
import { HttpApi, HttpApiEndpoint, HttpApiGroup } from "effect/http-api";
import { Conflict, Invalid, NotFound, OperationFailed, Unavailable } from "./errors";
import {
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
  TemplateSlugInput,
  Workspace,
  WorkspaceCommit,
  WorkspaceEntry,
  WorkspaceFile,
  WorkspaceFiles,
  WorkspaceKind,
  WorkspacePublish,
} from "./schemas";
import { DashboardSession, ProjectAccess, RequiresPermission } from "./session";

const project = { orgSlug: Schema.String };

/** What any operation on a Project's data can fail with besides access. */
const failures = [NotFound, Conflict, Invalid, OperationFailed];

/** Before sign-in: what the deployment offers. */
export class ConfigApi extends HttpApiGroup.make("dashboardConfig").add(
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
      params: { ...project, keyId: Schema.String },
      payload: ApiKeyInput,
      success: ApiKey,
    }).annotate(RequiresPermission, { apiKey: ["update"] }),
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
      error: failures,
      params: project,
      payload: CreateDomainInput,
      success: Domain,
    }).annotate(RequiresPermission, { domain: ["create"] }),
    // Checks SES, DNS and, for a claim, ownership now rather than on the worker's cadence.
    HttpApiEndpoint.post("refresh", "/:domainId/refresh", {
      error: failures,
      params: domain,
      success: Domain,
    }).annotate(RequiresPermission, { domain: ["create"] }),
    HttpApiEndpoint.delete("delete", "/:domainId", {
      error: failures,
      params: domain,
    }).annotate(RequiresPermission, { domain: ["delete"] }),
    // Not in the dashboard yet.
    HttpApiEndpoint.post("pause", "/:domainId/pause", {
      error: failures,
      params: domain,
      payload: PauseDomainInput,
    }).annotate(RequiresPermission, { domain: ["update"] }),
    HttpApiEndpoint.post("unpause", "/:domainId/unpause", {
      error: failures,
      params: domain,
    }).annotate(RequiresPermission, { domain: ["update"] }),
  )
  .middleware(ProjectAccess)
  .prefix("/projects/:orgSlug/domains") {}

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
    HttpApiEndpoint.post("archive", "/:templateId/archive", {
      error: failures,
      params: template,
      success: Template,
    }).annotate(RequiresPermission, { template: ["update"] }),
    HttpApiEndpoint.put("updateSlug", "/:templateId/slug", {
      error: failures,
      params: template,
      payload: TemplateSlugInput,
      success: Template,
    }).annotate(RequiresPermission, { template: ["update"] }),
    // Points the email variant at a published Workspace Entry.
    HttpApiEndpoint.put("linkReactEmail", "/:templateId/email", {
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
    HttpApiEndpoint.get("entries", "/entries", {
      error: failures,
      params: workspace,
      success: Schema.Array(WorkspaceEntry),
    }).annotate(RequiresPermission, { template: ["read"] }),
    HttpApiEndpoint.get("files", "/files", {
      error: builderFailures,
      params: workspace,
      success: WorkspaceFiles,
    }).annotate(RequiresPermission, { template: ["read"] }),
    HttpApiEndpoint.get("readFile", "/file", {
      error: builderFailures,
      params: workspace,
      query: { path: Schema.NonEmptyString },
      success: WorkspaceFile,
    }).annotate(RequiresPermission, { template: ["read"] }),
    HttpApiEndpoint.post("commit", "/commits", {
      error: builderFailures,
      params: workspace,
      payload: CommitWorkspaceInput,
      success: WorkspaceCommit,
    }).annotate(RequiresPermission, { template: ["update"] }),
    HttpApiEndpoint.post("depsSync", "/deps-sync", {
      error: builderFailures,
      params: workspace,
      success: WorkspaceCommit,
    }).annotate(RequiresPermission, { template: ["update"] }),
    HttpApiEndpoint.post("publish", "/publish", {
      error: builderFailures,
      params: workspace,
      success: WorkspacePublish,
    }).annotate(RequiresPermission, { template: ["update"] }),
    HttpApiEndpoint.post("preview", "/preview", {
      error: builderFailures,
      params: workspace,
      payload: PreviewEntryInput,
      success: EntryPreview,
    }).annotate(RequiresPermission, { template: ["read"] }),
  )
  .middleware(ProjectAccess)
  .prefix("/projects/:orgSlug/workspaces/:kind") {}

export class DashboardApi extends HttpApi.make("dashboard")
  .add(ConfigApi)
  .add(ProjectsApi)
  .add(ApiKeysApi)
  .add(DomainsApi)
  .add(TemplatesApi)
  .add(WorkspacesApi)
  .prefix("/api/dashboard") {}
