---
title: "Legacy send endpoints"
description: "The /send/{project}/raw/email and /send/{project}/template/email compatibility endpoints, and how to migrate to /messages/email."
---

## When to use these endpoints

Relayit keeps two older send endpoints so existing integrations keep working:

- `POST /send/{project}/raw/email` sends inline HTML or text.
- `POST /send/{project}/template/email` sends a Template by slug.

They run through the same pipeline as `POST /messages/email`, so Domains, Templates, suppression, and limits behave the same way.

Use them only if you already have code that calls them. New integrations should use [`POST /messages/email`](/docs/sending-email). It supports more features (multiple recipients, cc, bcc, reply-to, tags, custom headers, scheduling, idempotency) and returns more precise errors.

## Authentication and path

- `{project}` is your Project slug. Find it under **Settings > Project details**.
- Send the API key in `x-api-key` (or `X-API-Key`). The key must belong to the Project in the path.

| Status | Body `message` | When |
| --- | --- | --- |
| `401` | `Unauthorized` or the key error | The key is missing or invalid. |
| `404` | `Project not found` | The key is valid but belongs to a different Project than `{project}`. |

## Raw email

```bash
curl -X POST https://api.relayit.io/send/my-project/raw/email \
  -H "x-api-key: $RELAYIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "jane@example.com",
    "from": "hello@example.com",
    "payload": {
      "subject": "Your receipt",
      "html": "<p>Thanks for your order.</p>",
      "text": "Thanks for your order."
    }
  }'
```

`payload` needs a non-empty `subject` and at least one of `html` or `text`.

## Template email

```bash
curl -X POST https://api.relayit.io/send/my-project/template/email \
  -H "x-api-key: $RELAYIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "to": "jane@example.com",
    "from": "hello@example.com",
    "template": {
      "slug": "welcome-email",
      "props": { "name": "Jane" }
    }
  }'
```

`template.slug` accepts a slug or a `tmpl_` id. `props` is passed as the Template variables.

## Shared fields

| Field | Type | Description |
| --- | --- | --- |
| `to` | string | One recipient email address. |
| `from` | string | Optional plain email address (no display name). When omitted, the Project's sandbox address is used if the Sandbox Domain is active. |
| `contact` | object | Optional. `name` and `externalIdentifiers` (string map) for the recipient. |
| `app` | string | Optional App attribution. Ignored unless `appEnvironment` is also set. |
| `appEnvironment` | string | Optional App Environment attribution. Ignored unless `app` is also set. |
| `attachments` | array | Up to 20. Each has `filename` and either `content` (base64) or `path` (URL), plus optional `contentType` and `contentId`. |

If you omit `from` and the Project has no usable Sandbox Domain, the request fails with `400` and the message `No sender identity available; pass from or provision Sandbox Domain`.

## Responses

Success returns `201`:

```json
{
  "id": "msg_01jbxk3c1ef6h8w2m4n9qz7r5t",
  "status": "queued"
}
```

Errors use `{ "message": "...", "details": [...] }`:

| Status | Example body | Meaning |
| --- | --- | --- |
| `400` | `{ "message": "Validation error", "details": ["Invalid from address"] }` | Bad `from` address. |
| `400` | `{ "message": "The 'from' address is not a verified sending domain for this Project.", "details": ["invalid_from_address"] }` | Accept error. `details[0]` is the same `code` that `/messages/email` returns. |
| `429` | `{ "message": "Monthly email send limit exceeded", "details": ["monthly_limit_exceeded"] }` | Limit reached. No `retry_after_seconds`. |
| `500` | `{ "message": "Something went wrong", "details": [] }` | Server error. |

The accept error codes are listed in [Errors and limits](/docs/errors-and-limits#accept-errors-422).

## Migrate to /messages/email

The move is mostly renaming fields.

| Legacy | `/messages/email` |
| --- | --- |
| `POST /send/{project}/raw/email` | `POST /messages/email` (the Project comes from the API key) |
| `POST /send/{project}/template/email` | `POST /messages/email` with `template` |
| `payload.subject` | `subject` |
| `payload.html` | `html` |
| `payload.text` | `text` |
| `template.slug` | `template.id` (slug or `tmpl_` id) |
| `template.props` | `template.variables` |
| `to` (one address) | `to` (address, list, or Contact objects, up to 50) |
| `contact.name` | `to: { "email": "...", "first_name": "..." }` |
| `contact.externalIdentifiers` | `to: { "email": "...", "properties": { ... } }` |
| `app` and `appEnvironment` body fields | `app` and `environment` headers |
| `attachments[].contentType` | `attachments[].content_type` |
| `attachments[].contentId` | `attachments[].content_id` |
| `from` optional, defaults to sandbox | `from` required |
| Response `{ id, status }` | Response `{ id, stripped? }` |
| Errors `400` with `details: [code]` | Errors `422` with `code` and `details` object |
| `401` for bad keys | `403` with `code: "invalid_api_key"` |

Before:

```json
{
  "to": "jane@example.com",
  "from": "hello@example.com",
  "contact": { "name": "Jane" },
  "app": "shop",
  "appEnvironment": "production",
  "template": { "slug": "welcome-email", "props": { "name": "Jane" } }
}
```

After:

```bash
curl -X POST https://api.relayit.io/messages/email \
  -H "x-api-key: $RELAYIT_API_KEY" \
  -H "app: shop" \
  -H "environment: production" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "hello@example.com",
    "to": { "email": "jane@example.com", "first_name": "Jane" },
    "template": { "id": "welcome-email", "variables": { "name": "Jane" } }
  }'
```

Things to check when you switch:

- Always set `from`. There is no sandbox default.
- Handle `422` with `code` instead of `400` with `details`.
- If you only sent one of `app` or `appEnvironment` before, it was ignored. On `/messages/email` sending only one header is a `400` error.
- Add an `Idempotency-Key` header to make retries safe.
