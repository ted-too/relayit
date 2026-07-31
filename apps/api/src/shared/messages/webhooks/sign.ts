import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SECRET_PREFIX = "whsec_";

export function generateWebhookSigningSecret() {
  return `${SECRET_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/**
 * Sign outbound webhook body. Receivers may verify with current or previous
 * secret during the dual-secret window.
 */
export function signWebhookPayload({
  secret,
  idempotencyId,
  timestamp,
  body,
}: {
  secret: string;
  idempotencyId: string;
  timestamp: number;
  body: string;
}) {
  const signedPayload = `${idempotencyId}.${timestamp}.${body}`;
  const digest = createHmac("sha256", secret)
    .update(signedPayload)
    .digest("hex");
  return `v1=${digest}`;
}

export function verifyWebhookSignature({
  secrets,
  idempotencyId,
  timestamp,
  body,
  signatureHeader,
}: {
  secrets: string[];
  idempotencyId: string;
  timestamp: number;
  body: string;
  signatureHeader: string;
}): boolean {
  const expectedCandidates = secrets.map((secret) =>
    signWebhookPayload({ secret, idempotencyId, timestamp, body })
  );

  const provided = signatureHeader.trim();
  for (const expected of expectedCandidates) {
    const a = Buffer.from(expected);
    const b = Buffer.from(provided);
    if (a.length === b.length && timingSafeEqual(a, b)) {
      return true;
    }
  }
  return false;
}
