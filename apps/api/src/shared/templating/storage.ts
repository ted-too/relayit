import { GetObjectCommand } from "@aws-sdk/client-s3";
import { env } from "@repo/api/env";
import { s3, subBucket } from "@repo/api/object-storage";
import { createGenericError, type Result } from "@repo/api/utils";
import { typeid } from "typeid-js";

/**
 * Content-addressed Git objects for an Email Workspace.
 * Keyed by workspace + object id (sha). Branch tips live in Postgres.
 */
export const templatingGitObjects = subBucket({
  name: "templating.git",
  key: (p: { workspaceId: string; objectId: string }) => [
    p.workspaceId,
    "objects",
    p.objectId.slice(0, 2),
    p.objectId.slice(2),
  ],
});

/** Sealed render artifacts produced by workspace Publish / build. */
export const templatingArtifacts = subBucket({
  name: "templating.artifacts",
  key: (p: { workspaceId: string; entryId: string; revision: string }) => [
    p.workspaceId,
    p.entryId,
    p.revision,
  ],
});

export const templatingGitObjectClient = templatingGitObjects.with(s3);
export const templatingArtifactClient = templatingArtifacts.with(s3);

export function newArtifactRevision() {
  return typeid("trev").toString();
}

/** Download a sealed artifact by the full object key stored on the Entry. */
export async function downloadTemplatingArtifactByKey(
  key: string
): Promise<Result<Uint8Array>> {
  try {
    const response = await s3.send(
      new GetObjectCommand({
        Bucket: env.S3_BUCKET,
        Key: key,
      })
    );
    if (!response.Body) {
      return {
        error: createGenericError("Sealed artifact body was empty"),
        data: null,
      };
    }
    return {
      error: null,
      data: new Uint8Array(await response.Body.transformToByteArray()),
    };
  } catch (error) {
    return {
      error: createGenericError("Failed to download sealed artifact", error),
      data: null,
    };
  }
}
