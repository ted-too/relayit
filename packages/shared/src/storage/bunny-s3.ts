import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createGenericError, type Result } from "../utils";

export type BunnyS3Config = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
};

export type PutAttachmentParams = {
  key: string;
  body: Buffer;
  contentType: string;
};

export type GetAttachmentResult = {
  body: Buffer;
  contentType?: string;
};

const UNSAFE_FILENAME_CHARS = /[^a-zA-Z0-9._-]+/g;
const MULTI_DASH = /-+/g;

export class BunnyAttachmentStorage {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(config: BunnyS3Config) {
    this.bucket = config.bucket;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
      forcePathStyle: true,
    });
  }

  /** Narrow wrapper — some tooling fails to resolve S3Client.send generics. */
  private sendCommand(
    command: PutObjectCommand | GetObjectCommand | DeleteObjectCommand
  ) {
    return (
      this.client as unknown as {
        send: (
          cmd: PutObjectCommand | GetObjectCommand | DeleteObjectCommand
        ) => Promise<{
          Body?: { transformToByteArray: () => Promise<Uint8Array> };
          ContentType?: string;
        }>;
      }
    ).send(command);
  }

  async put(params: PutAttachmentParams): Promise<Result<{ key: string }>> {
    try {
      await this.sendCommand(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: params.key,
          Body: params.body,
          ContentType: params.contentType,
          ContentLength: params.body.byteLength,
        })
      );
      return { error: null, data: { key: params.key } };
    } catch (error) {
      return {
        error: createGenericError(
          "Failed to upload attachment to storage",
          error
        ),
        data: null,
      };
    }
  }

  async get(key: string): Promise<Result<GetAttachmentResult>> {
    try {
      const result = await this.sendCommand(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );

      if (!result.Body) {
        return {
          error: createGenericError("Attachment object has empty body", key),
          data: null,
        };
      }

      const bytes = await result.Body.transformToByteArray();
      return {
        error: null,
        data: {
          body: Buffer.from(bytes),
          contentType: result.ContentType,
        },
      };
    } catch (error) {
      return {
        error: createGenericError(
          "Failed to download attachment from storage",
          error
        ),
        data: null,
      };
    }
  }

  async delete(key: string): Promise<Result<{ key: string }>> {
    try {
      await this.sendCommand(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        })
      );
      return { error: null, data: { key } };
    } catch (error) {
      return {
        error: createGenericError(
          "Failed to delete attachment from storage",
          error
        ),
        data: null,
      };
    }
  }

  async deleteMany(keys: string[]): Promise<void> {
    await Promise.all(keys.map((key) => this.delete(key)));
  }
}

export function createBunnyAttachmentStorage(
  config: BunnyS3Config
): BunnyAttachmentStorage {
  return new BunnyAttachmentStorage(config);
}

export function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim() || "attachment";
  const sanitized = trimmed
    .replace(UNSAFE_FILENAME_CHARS, "-")
    .replace(MULTI_DASH, "-")
    .slice(0, 200);
  return sanitized || "attachment";
}

export function buildAttachmentStorageKey(params: {
  organizationId: string;
  messageId: string;
  filename: string;
  uniqueId: string;
}): string {
  const safeName = sanitizeFilename(params.filename);
  return `attachments/${params.organizationId}/${params.messageId}/${params.uniqueId}-${safeName}`;
}
