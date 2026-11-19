---
title: "Webhook events"
description: "The events Relayit sends a Webhook Endpoint about a send: sent, skipped and failed, and which recipients were left out."
---

A Webhook Endpoint is an HTTPS URL of yours that Relayit posts a Project's events to. Each Endpoint subscribes to the event types it wants.

> **Note:** You cannot create a Webhook Endpoint yourself yet: neither the dashboard nor the API manages them. This page describes the events an Endpoint receives about a send, and how to verify them.

## The request

Every event is a `POST` with a JSON body:

```json
{
  "type": "message.sent",
  "created_at": "2026-11-19T09:30:00.000Z",
  "data": {
    "message_id": "msg_01jbxk3c1ef6h8w2m4n9qz7r5t",
    "delivery_id": "edlv_01jbxk3c1ff6h8w2m4n9qz7r5v",
    "provider_message_id": "0100019338a1b2c3-4d5e6f70-0000-0000-0000-000000000000-000000"
  }
}
```

| Header              | Value                                                        |
| ------------------- | ------------------------------------------------------------ |
| `webhook-id`        | The event's id. The same for every attempt to deliver it.    |
| `webhook-timestamp` | When this attempt was made, in seconds since the Unix epoch. |
| `webhook-signature` | `v1=` followed by the signature, in lower-case hex.          |

Events are delivered at least once and in no particular order. Deduplicate on `webhook-id`, and answer with a `2xx` status within 30 seconds. Anything else is tried again, up to 8 attempts with growing gaps of up to an hour between them.

Treat `data` as open: new fields may be added to an event, as `stripped` was to `message.sent`. Ignore fields you do not know.

### Verifying the signature

The signature is the HMAC-SHA256 of `{webhook-id}.{webhook-timestamp}.{body}`, where `body` is the raw request body, byte for byte. The key is the Endpoint's whole signing secret as a UTF-8 string, `whsec_` prefix included.

The header names resemble [Standard Webhooks](https://www.standardwebhooks.com/), but the scheme is not the same: the secret is not base64-decoded and the signature is `v1=<hex>`, not `v1,<base64>`. A Standard Webhooks library will reject these requests, so verify them yourself:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const verify = (headers: Headers, rawBody: string, secret: string) => {
  const id = headers.get("webhook-id") ?? "";
  const timestamp = headers.get("webhook-timestamp") ?? "";
  // Refuse a request replayed long after it was signed.
  const age = Date.now() / 1000 - Number(timestamp);
  if (!Number.isFinite(age) || Math.abs(age) > 300) {
    return false;
  }
  const expected = `v1=${createHmac("sha256", secret)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("hex")}`;
  const given = Buffer.from(headers.get("webhook-signature") ?? "");
  return given.length === expected.length && timingSafeEqual(given, Buffer.from(expected));
};
```

## How a send ends

A `201` from `POST /messages/email` means the send was accepted. One of these events says how its Delivery ended:

| Event              | The Delivery ended | Meaning                                             |
| ------------------ | ------------------ | --------------------------------------------------- |
| `message.sent`     | `sent`             | SES accepted it for at least one recipient.         |
| `delivery.skipped` | `skipped`          | No recipient was left to send to. Nothing was sent. |
| `message.failed`   | `failed`           | It could not be sent. `error` says why.             |

A skipped or failed Delivery does not count towards your Usage.

### `message.sent`

| Field                 | Type   | Description                                                                        |
| --------------------- | ------ | ---------------------------------------------------------------------------------- |
| `message_id`          | string | The Message id the send returned.                                                  |
| `delivery_id`         | string | The Delivery.                                                                      |
| `provider_message_id` | string | SES's id for the email.                                                            |
| `stripped`            | array  | Recipients the email was **not** sent to. Present only when there is at least one. |

A recipient can stop being sendable between your request and the moment the email goes out: their address hard-bounces or they complain about another email, or, for a marketing email, they unsubscribe. Relayit checks again just before sending, sends to everyone else, and lists who it left out in `stripped`:

```json
{
  "type": "message.sent",
  "created_at": "2026-11-19T09:30:00.000Z",
  "data": {
    "message_id": "msg_01jbxk3c1ef6h8w2m4n9qz7r5t",
    "delivery_id": "edlv_01jbxk3c1ff6h8w2m4n9qz7r5v",
    "provider_message_id": "0100019338a1b2c3-4d5e6f70-0000-0000-0000-000000000000-000000",
    "stripped": [
      { "email": "bounced@example.com", "reason": "suppression" },
      { "email": "reader@example.com", "reason": "unsubscribed" }
    ]
  }
}
```

Each entry has the `email` as you sent it, whether it was in `to`, `cc` or `bcc`, and a `reason`:

| Reason         | Meaning                                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------- |
| `suppression`  | The address is suppressed: it hard-bounced, was suppressed by hand, or (for a marketing email) its owner complained. |
| `unsubscribed` | The Contact unsubscribed from the email's Topic or from all marketing. Marketing emails only, never transactional.   |

An address that is both suppressed and unsubscribed is listed as `suppression`.

`stripped` covers recipients removed after the send was accepted. Recipients already suppressed when you made the request are removed then and listed in the [response's `stripped`](/docs/sending-email#response) instead; they are not repeated in the event.

### `delivery.skipped`

Sent when every recipient was left out, so there was no one to send to.

| Field         | Type   | Description                           |
| ------------- | ------ | ------------------------------------- |
| `message_id`  | string | The Message id the send returned.     |
| `delivery_id` | string | The Delivery.                         |
| `reason`      | string | One of `suppression`, `unsubscribed`. |

```json
{
  "type": "delivery.skipped",
  "created_at": "2026-11-19T09:30:00.000Z",
  "data": {
    "message_id": "msg_01jbxk3c1ef6h8w2m4n9qz7r5t",
    "delivery_id": "edlv_01jbxk3c1ff6h8w2m4n9qz7r5v",
    "reason": "unsubscribed"
  }
}
```

`unsubscribed` means every recipient had unsubscribed; it is only ever the reason for a marketing email. When some recipients were suppressed and the rest unsubscribed, the reason is `suppression`.

### `message.failed`

| Field         | Type   | Description                                                                  |
| ------------- | ------ | ---------------------------------------------------------------------------- |
| `message_id`  | string | The Message id the send returned.                                            |
| `delivery_id` | string | The Delivery.                                                                |
| `error`       | string | Why it failed, for example `Domain is paused` or `SES rejected the message`. |
