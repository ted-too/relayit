import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";
import { sessionMiddleware } from "@/lib/auth.functions";
import { auth } from "@/lib/auth.server";
import { runApp } from "@/lib/layers.server";
import { requireOrganizationBySlug } from "@/lib/projects/org.server";
import { runTemplatingBuilder } from "@/lib/templating/builder.server";
import {
  archiveTemplateForProject,
  createTemplateForProject,
  getTemplateForProject,
  listTemplatesForProject,
  putReactEmailChannelForProject,
  updateTemplateSlugForProject,
} from "@/lib/templating/catalog.server";
import {
  archiveTemplateInputSchema,
  commitWorkspaceFilesInputSchema,
  createTemplateInputSchema,
  getTemplateInputSchema,
  getWorkspaceInputSchema,
  listTemplatesInputSchema,
  listWorkspaceEntriesInputSchema,
  listWorkspaceFilesInputSchema,
  previewWorkspaceEntryInputSchema,
  putReactEmailChannelInputSchema,
  readWorkspaceFileInputSchema,
  updateTemplateSlugInputSchema,
  workspaceIdOnlyInputSchema,
} from "@/lib/templating/schemas";
import {
  getOrCreateHostedWorkspaceMeta,
  listWorkspaceEntriesForProject,
} from "@/lib/templating/workspace.server";

const assertTemplatePermission = async (input: {
  readonly organizationId: string;
  readonly permission: "create" | "read" | "update" | "delete";
}) => {
  const headers = getRequestHeaders();
  const allowed = await auth.api.hasPermission({
    body: {
      organizationId: input.organizationId,
      permissions: { template: [input.permission] },
    },
    headers,
  });

  if (!allowed) {
    throw new Error("You do not have permission to manage Templates");
  }
};

export const listTemplatesFn = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .validator(listTemplatesInputSchema)
  .handler(async ({ data }) => {
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertTemplatePermission({
      organizationId: org.id,
      permission: "read",
    });
    return runApp(listTemplatesForProject(org.id));
  });

export const getTemplateFn = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .validator(getTemplateInputSchema)
  .handler(async ({ data }) => {
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertTemplatePermission({
      organizationId: org.id,
      permission: "read",
    });
    return runApp(
      getTemplateForProject({
        organizationId: org.id,
        templateId: data.templateId,
      })
    );
  });

export const createTemplateFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(createTemplateInputSchema)
  .handler(async ({ data }) => {
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertTemplatePermission({
      organizationId: org.id,
      permission: "create",
    });
    return runApp(
      createTemplateForProject({
        name: data.name,
        organizationId: org.id,
      })
    );
  });

export const archiveTemplateFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(archiveTemplateInputSchema)
  .handler(async ({ data }) => {
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertTemplatePermission({
      organizationId: org.id,
      permission: "update",
    });
    return runApp(
      archiveTemplateForProject({
        organizationId: org.id,
        templateId: data.templateId,
      })
    );
  });

export const updateTemplateSlugFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(updateTemplateSlugInputSchema)
  .handler(async ({ data }) => {
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertTemplatePermission({
      organizationId: org.id,
      permission: "update",
    });
    return runApp(
      updateTemplateSlugForProject({
        organizationId: org.id,
        slug: data.slug,
        templateId: data.templateId,
      })
    );
  });

export const putReactEmailChannelFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(putReactEmailChannelInputSchema)
  .handler(async ({ data }) => {
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertTemplatePermission({
      organizationId: org.id,
      permission: "update",
    });
    return runApp(
      putReactEmailChannelForProject({
        organizationId: org.id,
        subject: data.subject,
        templateId: data.templateId,
        workspaceEntryId: data.workspaceEntryId,
      })
    );
  });

export const getWorkspaceFn = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .validator(getWorkspaceInputSchema)
  .handler(async ({ data }) => {
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertTemplatePermission({
      organizationId: org.id,
      permission: "read",
    });
    const workspace = await runApp(
      getOrCreateHostedWorkspaceMeta({
        kind: data.kind,
        organizationId: org.id,
      })
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
  });

export const listWorkspaceEntriesFn = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .validator(listWorkspaceEntriesInputSchema)
  .handler(async ({ data }) => {
    const org = await runApp(requireOrganizationBySlug(data.orgSlug));
    await assertTemplatePermission({
      organizationId: org.id,
      permission: "read",
    });
    return runApp(
      listWorkspaceEntriesForProject({
        kind: data.kind,
        organizationId: org.id,
      })
    );
  });

const requireWorkspaceForOrg = async (input: {
  readonly kind: "reactEmail";
  readonly orgSlug: string;
  readonly permission: "read" | "update";
}) => {
  const org = await runApp(requireOrganizationBySlug(input.orgSlug));
  await assertTemplatePermission({
    organizationId: org.id,
    permission: input.permission,
  });
  const workspace = await runApp(
    getOrCreateHostedWorkspaceMeta({
      kind: input.kind,
      organizationId: org.id,
    })
  );
  return { org, workspace };
};

export const listWorkspaceFilesFn = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .validator(listWorkspaceFilesInputSchema)
  .handler(async ({ data }) => {
    const { workspace } = await requireWorkspaceForOrg({
      kind: data.kind,
      orgSlug: data.orgSlug,
      permission: "read",
    });
    return runTemplatingBuilder((client) =>
      client.listFiles({ workspaceId: workspace.id })
    );
  });

export const readWorkspaceFileFn = createServerFn({ method: "GET" })
  .middleware([sessionMiddleware])
  .validator(readWorkspaceFileInputSchema)
  .handler(async ({ data }) => {
    const { workspace } = await requireWorkspaceForOrg({
      kind: data.kind,
      orgSlug: data.orgSlug,
      permission: "read",
    });
    return runTemplatingBuilder((client) =>
      client.readFile({
        path: data.path,
        workspaceId: workspace.id,
      })
    );
  });

export const commitWorkspaceFilesFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(commitWorkspaceFilesInputSchema)
  .handler(async ({ data }) => {
    const { workspace } = await requireWorkspaceForOrg({
      kind: data.kind,
      orgSlug: data.orgSlug,
      permission: "update",
    });
    return runTemplatingBuilder((client) =>
      client.commitFiles({
        changes: data.changes,
        ...(data.message ? { message: data.message } : {}),
        workspaceId: workspace.id,
      })
    );
  });

export const depsSyncWorkspaceFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(workspaceIdOnlyInputSchema)
  .handler(async ({ data }) => {
    const { workspace } = await requireWorkspaceForOrg({
      kind: data.kind,
      orgSlug: data.orgSlug,
      permission: "update",
    });
    return runTemplatingBuilder((client) =>
      client.depsSync({ workspaceId: workspace.id })
    );
  });

export const publishWorkspaceFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(workspaceIdOnlyInputSchema)
  .handler(async ({ data }) => {
    const { workspace } = await requireWorkspaceForOrg({
      kind: data.kind,
      orgSlug: data.orgSlug,
      permission: "update",
    });
    return runTemplatingBuilder((client) =>
      client.publish({ workspaceId: workspace.id })
    );
  });

export const previewWorkspaceEntryFn = createServerFn({ method: "POST" })
  .middleware([sessionMiddleware])
  .validator(previewWorkspaceEntryInputSchema)
  .handler(async ({ data }) => {
    const { workspace } = await requireWorkspaceForOrg({
      kind: data.kind,
      orgSlug: data.orgSlug,
      permission: "read",
    });
    return runTemplatingBuilder((client) =>
      client.preview({
        entryId: data.entryId,
        ...(data.props ? { props: data.props } : {}),
        ...(data.subject ? { subjectOverride: data.subject } : {}),
        workspaceId: workspace.id,
      })
    ).then((result) => ({
      commitSha: result.commitSha,
      html: result.html,
      // JSON string — TanStack Start rejects Record<string, unknown> as serializable.
      propsJson: JSON.stringify(result.props),
      subject: result.subject,
      ...(result.text === undefined ? {} : { text: result.text }),
    }));
  });
