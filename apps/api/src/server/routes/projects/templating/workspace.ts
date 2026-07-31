import { auth } from "@repo/api/server/lib/auth";
import { betterAuthOrganization } from "@repo/api/server/lib/auth/handler";
import { apiRedis } from "@repo/api/server/lib/redis";
import {
  getOrCreateHostedWorkspace,
  listWorkspaceEntries,
} from "@repo/api/templating";
import {
  templatingCommitFiles,
  templatingDepsSync,
  templatingListFiles,
  templatingPublish,
  templatingReadFile,
} from "@repo/api/templating/builder";
import { previewHostedWorkspaceEntry } from "@repo/api/templating/publish";
import {
  templatingWorkspaceCommitBodySchema,
  templatingWorkspaceEntryParamsSchema,
  templatingWorkspaceFileParamsSchema,
  templatingWorkspaceKindParamsSchema,
  templatingWorkspacePreviewBodySchema,
} from "@repo/api/validators/routes/projects/templating/workspace";
import { Elysia, status } from "elysia";

function serializeEntry(entry: {
  id: string;
  path: string;
  artifactStorageKey: string | null;
  artifactCommitSha: string | null;
  inferredProps: unknown;
  builtAt: Date | null;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  const pickable = Boolean(!entry.deletedAt && entry.artifactStorageKey);

  return {
    id: entry.id,
    path: entry.path,
    pickable,
    artifactCommitSha: entry.artifactCommitSha,
    inferredProps: entry.inferredProps,
    builtAt: entry.builtAt,
    deletedAt: entry.deletedAt,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

async function requireTemplatePermission(
  request: Request,
  organizationId: string,
  action: "read" | "update"
) {
  const hasPermission = await auth.api.hasPermission({
    headers: request.headers,
    body: {
      organizationId,
      permissions: { template: [action] },
    },
  });
  return Boolean(hasPermission);
}

/**
 * Hosted workspace metadata, Git file BFF, deps sync, Publish, and preview.
 */
export const templatingWorkspaceRoutes = new Elysia({
  prefix: "/templating/workspace/:kind",
})
  .use(betterAuthOrganization)
  .guard({
    organization: true,
    auth: true,
  })
  .get(
    "/",
    async ({ params, organization, request }) => {
      if (
        !(await requireTemplatePermission(request, organization.id, "read"))
      ) {
        return status(403, "You do not have permission to read Templates");
      }

      const workspace = await getOrCreateHostedWorkspace(
        organization.id,
        params.kind
      );

      return {
        id: workspace.id,
        kind: workspace.kind,
        source: workspace.source,
        lastBuildAt: workspace.lastBuildAt,
        lastBuildError: workspace.lastBuildError,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      };
    },
    { params: templatingWorkspaceKindParamsSchema }
  )
  .get(
    "/entries",
    async ({ params, organization, request }) => {
      if (
        !(await requireTemplatePermission(request, organization.id, "read"))
      ) {
        return status(403, "You do not have permission to read Templates");
      }

      const workspace = await getOrCreateHostedWorkspace(
        organization.id,
        params.kind
      );
      const entries = await listWorkspaceEntries(workspace.id);
      return entries.map(serializeEntry);
    },
    { params: templatingWorkspaceKindParamsSchema }
  )
  .get(
    "/files",
    async ({ params, organization, request }) => {
      if (
        !(await requireTemplatePermission(request, organization.id, "read"))
      ) {
        return status(403, "You do not have permission to read Templates");
      }

      const workspace = await getOrCreateHostedWorkspace(
        organization.id,
        params.kind
      );
      const listed = await templatingListFiles({
        workspaceId: workspace.id,
        redis: apiRedis,
      });
      if (listed.error || !listed.data) {
        return status(400, listed.error?.message ?? "Failed to list files");
      }
      return listed.data;
    },
    { params: templatingWorkspaceKindParamsSchema }
  )
  .get(
    "/files/*",
    async ({ params, organization, request }) => {
      if (
        !(await requireTemplatePermission(request, organization.id, "read"))
      ) {
        return status(403, "You do not have permission to read Templates");
      }

      const workspace = await getOrCreateHostedWorkspace(
        organization.id,
        params.kind
      );
      const read = await templatingReadFile({
        workspaceId: workspace.id,
        path: params["*"],
        redis: apiRedis,
      });
      if (read.error || !read.data) {
        return status(404, read.error?.message ?? "File not found");
      }
      return read.data;
    },
    { params: templatingWorkspaceFileParamsSchema }
  )
  .put(
    "/files",
    async ({ params, organization, request, body }) => {
      if (
        !(await requireTemplatePermission(request, organization.id, "update"))
      ) {
        return status(403, "You do not have permission to update Templates");
      }

      const workspace = await getOrCreateHostedWorkspace(
        organization.id,
        params.kind
      );
      const committed = await templatingCommitFiles({
        workspaceId: workspace.id,
        redis: apiRedis,
        message: body.message,
        changes: body.changes,
      });
      if (committed.error || !committed.data) {
        return status(400, committed.error?.message ?? "Commit failed");
      }
      return committed.data;
    },
    {
      params: templatingWorkspaceKindParamsSchema,
      body: templatingWorkspaceCommitBodySchema,
    }
  )
  .post(
    "/deps-sync",
    async ({ params, organization, request }) => {
      if (
        !(await requireTemplatePermission(request, organization.id, "update"))
      ) {
        return status(403, "You do not have permission to update Templates");
      }

      const workspace = await getOrCreateHostedWorkspace(
        organization.id,
        params.kind
      );
      const synced = await templatingDepsSync({
        workspaceId: workspace.id,
        redis: apiRedis,
      });
      if (synced.error || !synced.data) {
        return status(400, synced.error?.message ?? "Deps sync failed");
      }
      return synced.data;
    },
    { params: templatingWorkspaceKindParamsSchema }
  )
  .post(
    "/publish",
    async ({ params, organization, request }) => {
      if (
        !(await requireTemplatePermission(request, organization.id, "update"))
      ) {
        return status(403, "You do not have permission to update Templates");
      }

      const workspace = await getOrCreateHostedWorkspace(
        organization.id,
        params.kind
      );
      const published = await templatingPublish({
        workspaceId: workspace.id,
        redis: apiRedis,
      });
      if (published.error || !published.data) {
        return status(400, published.error?.message ?? "Publish failed");
      }
      return published.data;
    },
    { params: templatingWorkspaceKindParamsSchema }
  )
  .post(
    "/entries/:entryId/preview",
    async ({ params, organization, request, body }) => {
      if (
        !(await requireTemplatePermission(request, organization.id, "read"))
      ) {
        return status(403, "You do not have permission to read Templates");
      }

      const workspace = await getOrCreateHostedWorkspace(
        organization.id,
        params.kind
      );
      const previewed = await previewHostedWorkspaceEntry({
        workspaceId: workspace.id,
        entryId: params.entryId,
        redis: apiRedis,
        props: body.props,
        subjectOverride: body.subject,
      });
      if (previewed.error || !previewed.data) {
        return status(400, previewed.error?.message ?? "Preview failed");
      }
      return previewed.data;
    },
    {
      params: templatingWorkspaceEntryParamsSchema,
      body: templatingWorkspacePreviewBodySchema,
    }
  );
