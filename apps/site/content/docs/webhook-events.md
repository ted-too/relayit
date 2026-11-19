---
title: "Webhook events"
description: "The events Relayit sends a Webhook Endpoint about a send: sent, skipped and failed, and which recipients were left out."
---

A Webhook Endpoint is an HTTPS URL of yours that Relayit posts a Project's events to. Each Endpoint subscribes to the event types it wants.

> **Note:** Webhook Endpoints cannot be managed from the dashboard yet. This page describes the events an Endpoint receives about a send.

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

| Header              | Value                                                                                                                         |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `webhook-id`        | The event's id. The same for every attempt to deliver it.                                                                     |
| `webhook-timestamp` | When this attempt was made, in seconds since the Unix epoch.                                                                  |
| `webhook-signature` | `v1=` followed by the hex HMAC-SHA256 of `{webhook-id}.{webhook-timestamp}.{body}`, keyed with the Endpoint's signing secret. |

Events are delivered at least once and in no particular order. Deduplicate on `webhook-id`, and answer with a `2xx` status; anything else is retried.

Treat `data` as open: new fields may be added to an event, as `stripped` was to `message.sent`. Ignore fields you do not know.

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

| Reason         | Meaning                                                                                                            |
| -------------- | ------------------------------------------------------------------------------------------------------------------ |
| `suppression`  | The address is suppressed: it hard-bounced, or (for a marketing email) its owner complained.                       |
| `unsubscribed` | The Contact unsubscribed from the email's Topic or from all marketing. Marketing emails only, never transactional. |

An address that is both suppressed and unsubscribed is listed as `suppression`.

`stripped` covers recipients removed after the send was accepted. Recipients already suppressed when you made the request are removed then and listed in the [response's `stripped`](/docs/sending-email#response) instead; they are not repeated in the event.

### `delivery.skipped`

Sent when every recipient was left out, so there was no one to send to.

| Field         | Type   | Description                       |
| ------------- | ------ | --------------------------------- |
| `message_id`  | string | The Message id the send returned. |
| `delivery_id` | string | The Delivery.                     |
| `reason`      | string | `suppression` or `unsubscribed`.  |

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
