import type { DateTime } from "effect";
import type { z } from "zod";

export interface ObjectStorageConfig {
  readonly accessKeyId: string;
  readonly bucket: string;
  readonly endpoint: URL;
  readonly region: string;
  readonly secretAccessKey: string;
}

export interface ObjectUploadOptions {
  readonly contentType?: string;
}

export interface ObjectSignedUploadUrlOptions {
  readonly contentType?: string;
  readonly expiresInSeconds?: number;
}

export interface ObjectSignedDownloadUrlOptions {
  readonly expiresInSeconds?: number;
}

export interface ObjectUploadResult {
  readonly key: string;
}

export interface ObjectDownloadResult {
  readonly body: Uint8Array;
  readonly contentType?: string;
}

export interface ObjectSignedUploadUrlResult {
  readonly expiresAt: DateTime.Utc;
  readonly key: string;
  readonly url: string;
}

export interface ObjectSignedDownloadUrlResult {
  readonly expiresAt: DateTime.Utc;
  readonly url: string;
}

export type ObjectKeySegment = string | number;

export interface SubBucketDefinition<S extends z.ZodType> {
  readonly key: (params: z.infer<S>) => readonly ObjectKeySegment[];
  readonly name: readonly ObjectKeySegment[];
  readonly schema: S;
}

export const DEFAULT_SIGNED_URL_EXPIRES_SECONDS = 3600;
