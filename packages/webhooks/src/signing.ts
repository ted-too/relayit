import { createHmac, randomBytes } from "node:crypto";

const SECRET_PREFIX = "whsec_";
const SECRET_BYTES = 32;

export interface SignWebhookPayloadOptions {
  readonly body: string;
  readonly idempotencyId: string;
  readonly secret: string;
  readonly timestamp: number;
}

export const generateWebhookSigningSecret = (): string =>
  `${SECRET_PREFIX}${randomBytes(SECRET_BYTES).toString("base64url")}`;

export const signWebhookPayload = ({
  secret,
  idempotencyId,
  timestamp,
  body,
}: SignWebhookPayloadOptions): string => {
  const signedPayload = `${idempotencyId}.${timestamp}.${body}`;
  const digest = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");

  return `v1=${digest}`;
};
