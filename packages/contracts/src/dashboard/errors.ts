/**
 * What a dashboard operation can refuse with, each carrying the message the dashboard
 * shows. Messages are static copy: identifiers stay out of them.
 */
import { Schema } from "effect";

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

/** The change conflicts with the current state: a slug taken, a Domain another Project holds. */
export class Conflict extends Schema.TaggedError<Conflict>()(
  "Conflict",
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}

/** Input the schema accepts but the operation can't use. */
export class Invalid extends Schema.TaggedError<Invalid>()(
  "Invalid",
  { message: Schema.String },
  { httpApiStatus: 422 },
) {}

/** Something this deployment doesn't have configured, such as the template builder. */
export class Unavailable extends Schema.TaggedError<Unavailable>()(
  "Unavailable",
  { message: Schema.String },
  { httpApiStatus: 503 },
) {}

/** The operation failed on our side; the api logged why. */
export class OperationFailed extends Schema.TaggedError<OperationFailed>()(
  "OperationFailed",
  { message: Schema.String },
  { httpApiStatus: 500 },
) {}
