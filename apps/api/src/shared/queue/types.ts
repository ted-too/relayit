import type * as z from "zod";

/** Wire is always string in Redis; decode = wire → app, encode = app → wire */
export type StreamPayloadCodec<T> = z.ZodCodec<z.ZodString, z.ZodType<T>>;

export interface StreamConfig<T> {
  codec: StreamPayloadCodec<T>;
  group?: string;
  scheduleKey?: string;
  stream: string;
}

export interface StreamMessage<T> {
  id: string;
  payload: T;
}

export const STREAM_PAYLOAD_FIELD = "payload";

export function payloadFromFields(fields: string[]): string | null {
  const payloadIndex = fields.indexOf(STREAM_PAYLOAD_FIELD);
  if (payloadIndex >= 0 && fields[payloadIndex + 1]) {
    return fields[payloadIndex + 1];
  }
  return null;
}

export interface QueueEnvelope<T> {
  attempts: number;
  data: T;
  firstEnqueuedAt: number;
}
