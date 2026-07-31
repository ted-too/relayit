import crypto from "node:crypto";
import {
  parseUnsubscribeRecipient,
  unsubscribeInboundDomain,
} from "@repo/api/channels/email/unsubscribe";
import type { DbOrTx } from "@repo/api/db";
import { schema } from "@repo/api/db";
import { env } from "@repo/api/env";
import type { EmailHeaders } from "@repo/api/validators/routes/messages";
import { eq } from "drizzle-orm";

function signUnsubscribePayload({
  contactId,
  messageId,
}: {
  contactId: string;
  messageId: string;
}) {
  return crypto
    .createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`${contactId}:${messageId}`)
    .digest("base64url");
}

export function verifyUnsubscribe({
  contactId,
  messageId,
  signature,
}: {
  contactId: string;
  messageId: string;
  signature: string;
}) {
  const expected = signUnsubscribePayload({ contactId, messageId });
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature);

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function buildUnsubscribeUrl({
  orgSlug,
  contactId,
  messageId,
}: {
  orgSlug: string;
  contactId: string;
  messageId: string;
}) {
  const sig = signUnsubscribePayload({ contactId, messageId });
  const params = new URLSearchParams({ msg: messageId, sig });
  return `${env.API_URL}/organization/bySlug/${encodeURIComponent(orgSlug)}/contact/${encodeURIComponent(contactId)}/email/unsubscribe?${params.toString()}`;
}

const MAILTO_TOKEN_BYTES = 12;

function signUnsubscribeMailtoToken(contactId: string) {
  return crypto
    .createHmac("sha256", env.BETTER_AUTH_SECRET)
    .update(`unsub-mailto:${contactId}`)
    .digest()
    .subarray(0, MAILTO_TOKEN_BYTES)
    .toString("hex");
}

export function verifyUnsubscribeMailtoToken({
  contactId,
  signature,
}: {
  contactId: string;
  signature: string;
}) {
  const expected = signUnsubscribeMailtoToken(contactId);
  const expectedBuffer = Buffer.from(expected);
  const signatureBuffer = Buffer.from(signature.toLowerCase());

  if (expectedBuffer.length !== signatureBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(expectedBuffer, signatureBuffer);
}

export function buildUnsubscribeMailtoAddress(contactId: string) {
  const sig = signUnsubscribeMailtoToken(contactId);
  return `${contactId}.${sig}@${unsubscribeInboundDomain}`;
}

export function buildListUnsubscribeHeaders({
  httpsUrl,
  mailtoUrl,
}: {
  httpsUrl: string;
  mailtoUrl?: string;
}): EmailHeaders {
  const listUnsubscribe = mailtoUrl
    ? `<mailto:${mailtoUrl}>, <${httpsUrl}>`
    : `<${httpsUrl}>`;

  return {
    "List-Unsubscribe": listUnsubscribe,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}

export async function ingestUnsubscribeInbound({
  db,
  recipients,
}: {
  db: DbOrTx;
  recipients: string[];
}) {
  for (const recipient of recipients) {
    const parsed = parseUnsubscribeRecipient(recipient);
    if (!parsed) {
      continue;
    }
    if (
      !verifyUnsubscribeMailtoToken({
        contactId: parsed.contactId,
        signature: parsed.signature,
      })
    ) {
      continue;
    }

    await db
      .update(schema.contact)
      .set({ unsubscribed: true })
      .where(eq(schema.contact.id, parsed.contactId));
  }
}

export function renderUnsubscribeConfirmationPage({
  orgName,
  contactEmail,
  actionUrl,
}: {
  orgName: string;
  contactEmail: string;
  actionUrl: string;
}) {
  const escapedOrgName = orgName
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const escapedEmail = contactEmail
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const escapedActionUrl = actionUrl
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Unsubscribe</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { color: #444; line-height: 1.5; }
    button { margin-top: 1.5rem; padding: 0.625rem 1.25rem; font-size: 1rem; background: #111; color: #fff; border: none; border-radius: 0.375rem; cursor: pointer; }
    button:hover { background: #333; }
  </style>
</head>
<body>
  <h1>Unsubscribe from ${escapedOrgName}</h1>
  <p>Stop receiving emails at <strong>${escapedEmail}</strong>.</p>
  <form method="post" action="${escapedActionUrl}">
    <button type="submit">Unsubscribe</button>
  </form>
</body>
</html>`;
}

export function renderUnsubscribeErrorPage(message: string) {
  const escapedMessage = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Unsubscribe</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; color: #111; }
    p { color: #444; line-height: 1.5; }
  </style>
</head>
<body>
  <p>${escapedMessage}</p>
</body>
</html>`;
}

export function renderUnsubscribeSuccessPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Unsubscribed</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1rem; color: #111; }
    p { color: #444; line-height: 1.5; }
  </style>
</head>
<body>
  <p>You have been unsubscribed.</p>
</body>
</html>`;
}
