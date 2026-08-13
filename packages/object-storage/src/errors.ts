import { Data } from "effect";

type ObjectStorageOperation =
  | "delete"
  | "download"
  | "exists"
  | "signedDownloadUrl"
  | "signedUploadUrl"
  | "upload";

export class ObjectStorageError extends Data.TaggedError("ObjectStorageError")<{
  readonly cause: unknown;
  readonly key: string;
  readonly operation: ObjectStorageOperation;
}> {
  override get message() {
    return `Object storage ${this.operation} failed for ${this.key}`;
  }
}

export class ObjectBodyEmpty extends Data.TaggedError("ObjectBodyEmpty")<{
  readonly key: string;
}> {
  override get message() {
    return `Object body was empty for ${this.key}`;
  }
}

export class ObjectKeyParamsError extends Data.TaggedError(
  "ObjectKeyParamsError"
)<{
  readonly cause: unknown;
  readonly subBucket: string;
}> {
  override get message() {
    return `Invalid object storage key params for ${this.subBucket}`;
  }
}

export class ObjectSignedUrlExpiryError extends Data.TaggedError(
  "ObjectSignedUrlExpiryError"
)<{
  readonly expiresInSeconds: number;
  readonly maximumSeconds: number;
  readonly minimumSeconds: number;
  readonly operation: "signedDownloadUrl" | "signedUploadUrl";
}> {
  override get message() {
    return `Object storage ${this.operation} expiry must be between ${this.minimumSeconds} and ${this.maximumSeconds} seconds`;
  }
}
