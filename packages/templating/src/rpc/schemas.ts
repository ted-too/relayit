import { Schema } from "effect";

export const WorkspaceRefPayload = Schema.Struct({
  ref: Schema.optionalKey(Schema.String),
  workspaceId: Schema.String,
});

export const WorkspaceFilePayload = Schema.Struct({
  path: Schema.String,
  ref: Schema.optionalKey(Schema.String),
  workspaceId: Schema.String,
});

export const WorkspaceCommitPayload = Schema.Struct({
  changes: Schema.Record(Schema.String, Schema.NullOr(Schema.String)),
  message: Schema.optionalKey(Schema.String),
  workspaceId: Schema.String,
});

export const WorkspaceIdPayload = Schema.Struct({
  workspaceId: Schema.String,
});

export const WorkspacePreviewPayload = Schema.Struct({
  entryId: Schema.String,
  props: Schema.optionalKey(Schema.Record(Schema.String, Schema.Unknown)),
  subjectOverride: Schema.optionalKey(Schema.String),
  workspaceId: Schema.String,
});

export const BuilderFileList = Schema.Struct({
  commitSha: Schema.String,
  paths: Schema.Array(Schema.String),
  ref: Schema.String,
});

export const BuilderFileRead = Schema.Struct({
  commitSha: Schema.String,
  content: Schema.String,
  path: Schema.String,
  ref: Schema.String,
});

export const BuilderCommitResult = Schema.Struct({
  commitSha: Schema.String,
});

export const BuilderDepsSyncResult = Schema.Struct({
  commitSha: Schema.String,
});

export const BuilderPublishEntry = Schema.Struct({
  id: Schema.String,
  path: Schema.String,
  pickable: Schema.Boolean,
});

export const BuilderPublishResult = Schema.Struct({
  commitSha: Schema.String,
  entries: Schema.Array(BuilderPublishEntry),
});

export const BuilderPreviewResult = Schema.Struct({
  commitSha: Schema.String,
  html: Schema.String,
  props: Schema.Record(Schema.String, Schema.Unknown),
  subject: Schema.String,
  text: Schema.optionalKey(Schema.String),
});
