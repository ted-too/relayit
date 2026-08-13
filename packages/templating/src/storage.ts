import { subBucket } from "@repo/object-storage";
import { typeid } from "typeid-js";
import { z } from "zod";

/**
 * Content-addressed Git objects for an Email Workspace.
 * Keyed by workspace + object id (sha). Branch tips live in Postgres.
 */
export const templatingGitObjects = subBucket({
  key: (p: { objectId: string; workspaceId: string }) => [
    p.workspaceId,
    "objects",
    p.objectId.slice(0, 2),
    p.objectId.slice(2),
  ],
  name: ["templating", "git"],
  schema: z.object({
    objectId: z.string(),
    workspaceId: z.string(),
  }),
});

/** Sealed render artifacts produced by workspace Publish / build. */
export const templatingArtifacts = subBucket({
  key: (p: { entryId: string; revision: string; workspaceId: string }) => [
    p.workspaceId,
    p.entryId,
    p.revision,
  ],
  name: ["templating", "artifacts"],
  schema: z.object({
    entryId: z.string(),
    revision: z.string(),
    workspaceId: z.string(),
  }),
});

export const newArtifactRevision = () => typeid("trev").toString();
