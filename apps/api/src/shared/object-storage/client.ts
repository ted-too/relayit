import { S3Client } from "@aws-sdk/client-s3";
import { env } from "@repo/api/env";

/**
 * Shared S3-compatible client (R2 in production). Bind sub-buckets with
 * {@link subBucket}.with(s3).
 */
export const s3 = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY_ID,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY,
  },
  forcePathStyle: true,
});
