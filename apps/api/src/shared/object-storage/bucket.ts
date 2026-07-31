import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "@repo/api/env";
import { createGenericError } from "@repo/api/utils";
import {
  DEFAULT_SIGNED_URL_EXPIRES_SECONDS,
  type ObjectDownloadResult,
  type ObjectSignedDownloadUrlResult,
  type ObjectSignedUploadUrlResult,
  type SubBucket,
  type SubBucketClient,
  type SubBucketDefinition,
} from "./types";

function objectKey<KeyParams>(
  name: string,
  keyFn: (params: KeyParams) => string[],
  params: KeyParams
) {
  return `${name}/${keyFn(params).join("/")}`;
}

function toBody(body: Uint8Array | string): Uint8Array {
  return typeof body === "string" ? new TextEncoder().encode(body) : body;
}

/**
 * Define a sub-bucket: a named partition of the single object-storage bucket
 * (`env.S3_BUCKET`).
 *
 * There is only ever one physical bucket; each sub-bucket namespaces its
 * objects under `name/` within it. Follows the same factory + `.with` shape as
 * {@link task} and {@link circuitBreaker}: one definition, reused across
 * processes, keyed per logical object via `key(params)`.
 *
 * @example
 * ```ts
 * const dmarcReports = subBucket({
 *   name: "email.dmarc-reports",
 *   key: (p: { reportId: string }) => [p.reportId],
 * });
 *
 * await dmarcReports.with(s3).upload(
 *   { reportId: "dmrp_123" },
 *   rawEmail,
 *   { contentType: "message/rfc822" }
 * );
 * ```
 */
export function subBucket<KeyParams>(
  def: SubBucketDefinition<KeyParams>
): SubBucket<KeyParams> {
  const bucketName = env.S3_BUCKET;

  const keyFor = (params: KeyParams) => objectKey(def.name, def.key, params);

  return {
    name: def.name,
    bucket: bucketName,
    key: keyFor,

    with(client: S3Client): SubBucketClient<KeyParams> {
      return {
        async upload(params, body, opts) {
          const Key = keyFor(params);

          try {
            await client.send(
              new PutObjectCommand({
                Bucket: bucketName,
                Key,
                Body: toBody(body),
                ContentType: opts?.contentType,
                Metadata: opts?.metadata,
              })
            );

            return { data: { key: Key }, error: null };
          } catch (error) {
            return {
              data: null,
              error: createGenericError("Failed to upload object", error),
            };
          }
        },

        async download(params) {
          const Key = keyFor(params);

          try {
            const response = await client.send(
              new GetObjectCommand({ Bucket: bucketName, Key })
            );

            if (!response.Body) {
              return {
                data: null,
                error: createGenericError("Object body was empty"),
              };
            }

            const bytes = new Uint8Array(
              await response.Body.transformToByteArray()
            );
            const data: ObjectDownloadResult = {
              body: bytes,
              contentType: response.ContentType,
            };

            return { data, error: null };
          } catch (error) {
            return {
              data: null,
              error: createGenericError("Failed to download object", error),
            };
          }
        },

        async delete(params) {
          const Key = keyFor(params);

          try {
            await client.send(
              new DeleteObjectCommand({ Bucket: bucketName, Key })
            );
            return { data: undefined, error: null };
          } catch (error) {
            return {
              data: null,
              error: createGenericError("Failed to delete object", error),
            };
          }
        },

        async exists(params) {
          const Key = keyFor(params);

          try {
            await client.send(
              new HeadObjectCommand({ Bucket: bucketName, Key })
            );
            return true;
          } catch {
            return false;
          }
        },

        async signedUploadUrl(params, opts) {
          const Key = keyFor(params);
          const expiresIn =
            opts?.expiresInSeconds ?? DEFAULT_SIGNED_URL_EXPIRES_SECONDS;

          try {
            const command = new PutObjectCommand({
              Bucket: bucketName,
              Key,
              ContentType: opts?.contentType,
            });
            const url = await getSignedUrl(
              client as unknown as Parameters<typeof getSignedUrl>[0],
              command as Parameters<typeof getSignedUrl>[1],
              { expiresIn }
            );
            const data: ObjectSignedUploadUrlResult = {
              url,
              key: Key,
              expiresAt: new Date(Date.now() + expiresIn * 1000),
            };
            return { data, error: null };
          } catch (error) {
            return {
              data: null,
              error: createGenericError("Failed to sign upload URL", error),
            };
          }
        },

        async signedDownloadUrl(params, opts) {
          const Key = keyFor(params);
          const expiresIn =
            opts?.expiresInSeconds ?? DEFAULT_SIGNED_URL_EXPIRES_SECONDS;

          try {
            const command = new GetObjectCommand({ Bucket: bucketName, Key });
            const url = await getSignedUrl(
              client as unknown as Parameters<typeof getSignedUrl>[0],
              command as Parameters<typeof getSignedUrl>[1],
              { expiresIn }
            );
            const data: ObjectSignedDownloadUrlResult = {
              url,
              expiresAt: new Date(Date.now() + expiresIn * 1000),
            };
            return { data, error: null };
          } catch (error) {
            return {
              data: null,
              error: createGenericError("Failed to sign download URL", error),
            };
          }
        },
      };
    },
  };
}
