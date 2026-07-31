import type { S3Client } from "@aws-sdk/client-s3";
import type { Result } from "@repo/api/utils";

export interface ObjectUploadOptions {
  contentType?: string;
  metadata?: Record<string, string>;
}

export interface ObjectSignedUploadUrlOptions {
  contentType?: string;
  expiresInSeconds?: number;
}

export interface ObjectSignedDownloadUrlOptions {
  expiresInSeconds?: number;
}

export interface ObjectUploadResult {
  key: string;
}

export interface ObjectDownloadResult {
  body: Uint8Array;
  contentType?: string;
}

export interface ObjectSignedUploadUrlResult {
  expiresAt: Date;
  key: string;
  url: string;
}

export interface ObjectSignedDownloadUrlResult {
  expiresAt: Date;
  url: string;
}

/**
 * Producer-side API bound to an S3-compatible client.
 *
 * Obtain an instance with {@link SubBucket.with}. Safe to share across API and
 * worker processes that use the same credentials.
 */
export interface SubBucketClient<KeyParams> {
  delete(params: KeyParams): Promise<Result<void>>;
  download(params: KeyParams): Promise<Result<ObjectDownloadResult>>;
  exists(params: KeyParams): Promise<boolean>;
  signedDownloadUrl(
    params: KeyParams,
    opts?: ObjectSignedDownloadUrlOptions
  ): Promise<Result<ObjectSignedDownloadUrlResult>>;
  signedUploadUrl(
    params: KeyParams,
    opts?: ObjectSignedUploadUrlOptions
  ): Promise<Result<ObjectSignedUploadUrlResult>>;
  upload(
    params: KeyParams,
    body: Uint8Array | string,
    opts?: ObjectUploadOptions
  ): Promise<Result<ObjectUploadResult>>;
}

/**
 * A named partition of the single object-storage bucket (`env.S3_BUCKET`).
 *
 * There is only ever one physical bucket; each sub-bucket namespaces its
 * objects under a stable key prefix within it. Returned by {@link subBucket};
 * register once and reuse via {@link SubBucket.with}.
 */
export interface SubBucket<KeyParams> {
  /** The single physical bucket (`env.S3_BUCKET`). */
  readonly bucket: string;
  key(params: KeyParams): string;
  /** Sub-bucket partition name, used as the object key prefix. */
  readonly name: string;
  with(client: S3Client): SubBucketClient<KeyParams>;
}

/**
 * Definition passed to {@link subBucket}.
 *
 * Describes the partition name (key prefix within the single bucket) and how
 * logical keys are encoded under it.
 */
export interface SubBucketDefinition<KeyParams> {
  /** Ordered segments joined with `/` under the partition prefix. */
  key: (params: KeyParams) => string[];
  /** Partition name and object key prefix (e.g. `"email.dmarc-reports"`). */
  name: string;
}

export const DEFAULT_SIGNED_URL_EXPIRES_SECONDS = 3600;
