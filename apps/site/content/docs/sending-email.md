---
title: "Sending email"
description: "Complete guide to POST /messages/email: recipients, content, templates, attachments, scheduling, tags, headers, and idempotency."
---

## Overview

```http
POST https://api.relayit.io/messages/email
x-api-key: rel_org_...
Content-Type: application/json
```

This endpoint creates a transactional email. It is shaped to match Resend's send-email API, so most Resend request bodies work unchanged. Two things differ:

- Authenticate with the `x-api-key` header instead of `Authorization: Bearer`.
- Resend's `topic_id` field is not supported. Unknown fields, including `topic_id`, are rejected. Topic-based marketing sends will go through Campaigns (coming soon).

Body fields use snake_case. You can try every field in the interactive reference at https://api.relayit.io/docs. The machine-readable spec is at https://api.relayit.io/openapi.json.

## Headers

| Header | Required | Description |
| --- | --- | --- |
| `x-api-key` | Yes | A Project API key. See [API keys](/docs/api-keys). |
| `Content-Type` | Yes | `application/json`. |
| `Idempotency-Key` | No | Up to 256 characters. Repeating a key returns the original Message. See [Idempotency](#idempotency). |
| `app` | No | App attribution. Must be sent together with `environment`. |
| `environment` | No | App Environment attribution. Must be sent together with `app`. |

## Body fields

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| `from` | string | Yes | Sender address. See [From](#from). |
| `to` | Recipient | Yes | Primary recipients. See [Recipients](#recipients). |
| `subject` | string | With inline content | Subject line. Optional with `template` (overrides the Template subject). |
| `cc` | Recipient | No | Carbon copy recipients. |
| `bcc` | Recipient | No | Blind carbon copy recipients. |
| `reply_to` | string or string[] | No | Reply-To address or addresses (max 50). |
| `html` | string | One of `html`, `text`, or `template` | HTML body. |
| `text` | string | One of `html`, `text`, or `template` | Plain-text body. |
| `template` | object | One of `html`, `text`, or `template` | `{ "id": "...", "variables": { ... } }`. |
| `attachments` | Attachment[] | No | Files to attach. See [Attachments](#attachments). |
| `headers` | object | No | Custom email headers, string values only. |
| `tags` | Tag[] | No | `{ "name": "...", "value": "..." }` pairs. |
| `scheduled_at` | string | No | When to send. ISO 8601 preferred. |

## From

`from` accepts two formats:

```json
{ "from": "hello@example.com" }
```

```json
{ "from": "Acme Support <support@example.com>" }
```

A display name in double quotes also works: `"\"Acme, Inc.\" <hello@example.com>"`.

The address must be one of:

- An address on a Domain of this Project that is **verified** and **not paused**. The domain part must match the Domain exactly. If you verified `example.com`, then `hello@example.com` works but `hello@mail.example.com` does not, unless you also add `mail.example.com` as its own Domain.
- The Project's sandbox address, `sandbox@` the Sandbox Domain. Sandbox sends can only go to Project members.

Anything else fails with `422 invalid_from_address`. A string that is not a valid email address fails validation with the message `Invalid from address`.

## Recipients

`to`, `cc`, and `bcc` each accept any of these shapes:

```json
{ "to": "jane@example.com" }
```

```json
{ "to": ["jane@example.com", "sam@example.com"] }
```

```json
{
  "to": {
    "email": "jane@example.com",
    "first_name": "Jane",
    "last_name": "Doe",
    "properties": { "plan": "pro", "customer_id": "cus_123" }
  }
}
```

```json
{
  "to": [
    { "email": "jane@example.com", "first_name": "Jane" },
    { "email": "sam@example.com" }
  ]
}
```

Rules:

- Each field takes at most 50 entries.
- A list must be all strings or all Contact objects. Do not mix them in one array.
- Contact objects accept only `email`, `first_name`, `last_name`, and `properties`. `properties` values must be strings.
- The request needs at least one recipient across `to`, `cc`, and `bcc`.
- Contact data you pass is stored on the recipient's Contact in your Project. See [Concepts](/docs/concepts#contacts-suppression-and-topics).

Recipients that are suppressed for all mail (after a hard bounce) are removed before sending and listed in the response. If no recipients remain, the request fails with `all_recipients_suppressed`.

## Content: inline or template

Send exactly one kind of content:

- **Inline:** `html`, `text`, or both, plus a non-empty `subject`.
- **Template:** a `template` object. `subject` is optional and overrides the Template's subject.

Sending both, or neither, fails with `422` and the message `Provide either inline html/text or template, not both (and not neither).` Inline content without a subject fails with `subject is required when sending inline html/text`.

### Inline example

```json
{
  "from": "Acme <hello@example.com>",
  "to": "jane@example.com",
  "subject": "Your receipt",
  "html": "<h1>Thanks for your order</h1><p>Order #1042 is confirmed.</p>",
  "text": "Thanks for your order. Order #1042 is confirmed."
}
```

### Template example

```json
{
  "from": "Acme <hello@example.com>",
  "to": "jane@example.com",
  "template": {
    "id": "welcome-email",
    "variables": {
      "name": "Jane",
      "trial_days": 14
    }
  }
}
```

`template.id` is either a Template id (it starts with `tmpl_`) or the slug of an active Template. Values that start with `tmpl_` are looked up as ids, anything else as a slug.

What `variables` means depends on the Template's engine:

- **Primitive Templates:** a flat object. Each value must be a string or a number and must match the type declared on the Template. Placeholders in the Template look like `{{{name}}}`.
- **React Email Templates:** the props passed to your component. Any JSON shape works, including nested objects and arrays.

See [Templates](/docs/templates) for how to build them and which errors to expect.

## Attachments

Each attachment has a `filename` and exactly one source: base64 `content` or a hosted `path`.

```json
{
  "attachments": [
    {
      "filename": "invoice-1042.pdf",
      "content": "JVBERi0xLjQKJcfsj6IKNSAwIG9iago8PC9MZW5ndGggNiAwIFI..."
    },
    {
      "filename": "terms.pdf",
      "path": "https://files.example.com/terms.pdf"
    }
  ]
}
```

| Field | Description |
| --- | --- |
| `filename` | Required. Include the extension. It is used to pick the MIME type. |
| `content` | Base64-encoded file contents. Whitespace is ignored. |
| `path` | URL of a hosted file. Relayit downloads it when it accepts the request. |
| `content_type` | Optional MIME type. When omitted it is derived from the extension, falling back to `application/octet-stream`. |
| `content_id` | Optional id for an inline image. Reference it in HTML as `cid:<content_id>`. |

Limits and behavior:

- Each attachment can be at most 10 MB after decoding or download.
- Hosted files are fetched once, with a 30 second timeout. A non-2xx response fails the request with `invalid_attachment` and `reason: "fetch_failed"`.
- Attachments are stored for 7 days after the later of the send time and `scheduled_at`.
- Executable and script file types are blocked. A blocked filename fails with the message `This file type isn't allowed for security reasons.` The blocked extensions are:

```text
ade adp app asp bas bat cer chm cmd com cpl crt csh der exe fxp gadget hlp hta inf ins isp its js jse ksh lib lnk mad maf mag mam maq mar mas mat mau mav maw mda mdb mde mdt mdw mdz msc msh msh1 msh2 mshxml msh1xml msh2xml msi msp mst ops pcd pif plg prf prg reg scf scr sct shb shs sys ps1 ps1xml ps2 ps2xml psc1 psc2 tmp url vb vbe vbs vps vsmacros vss vst vsw vxd ws wsc wsf wsh xnk
```

### Inline images

Set `content_id` on the attachment and use it in your HTML:

```json
{
  "from": "Acme <hello@example.com>",
  "to": "jane@example.com",
  "subject": "Your weekly report",
  "html": "<p>Here is this week's chart:</p><img src=\"cid:weekly-chart\" alt=\"Chart\">",
  "attachments": [
    {
      "filename": "chart.png",
      "path": "https://files.example.com/reports/chart.png",
      "content_id": "weekly-chart"
    }
  ]
}
```

## Scheduling

Set `scheduled_at` to send later:

```json
{ "scheduled_at": "2026-11-02T09:00:00Z" }
```

Any value that JavaScript `Date.parse` accepts is allowed, but use ISO 8601 with a time zone to avoid surprises. An unparseable value fails with `scheduled_at must be a parseable date (ISO 8601 preferred)`. The Message is created and the Delivery waits until that time.

## Tags

Tags label a send with key-value pairs:

```json
{
  "tags": [
    { "name": "category", "value": "receipt" },
    { "name": "order_id", "value": "1042" }
  ]
}
```

`name` and `value` are each 1 to 256 characters and may only contain letters, digits, underscores, and hyphens.

## Custom headers

Add extra email headers with the `headers` object. Values must be strings.

```json
{
  "headers": {
    "X-Entity-Ref-ID": "order-1042"
  }
}
```

## Reply-To

```json
{ "reply_to": "support@example.com" }
```

```json
{ "reply_to": ["support@example.com", "billing@example.com"] }
```

## Idempotency

Send an `Idempotency-Key` header to make retries safe:

```bash
curl -X POST https://api.relayit.io/messages/email \
  -H "x-api-key: $RELAYIT_API_KEY" \
  -H "Idempotency-Key: order-1042-receipt" \
  -H "Content-Type: application/json" \
  -d '{"from":"hello@example.com","to":"jane@example.com","subject":"Receipt","text":"Thanks!"}'
```

- Keys are scoped to your Project and remembered for 24 hours.
- Repeating a key within that window returns `201` with the original Message `id`. No new email is sent. The replayed response does not include `stripped`.
- Keys can be up to 256 characters. Use something derived from your own data, such as an order id.

## App and environment attribution

Add the `app` and `environment` headers to attribute a send:

```bash
curl -X POST https://api.relayit.io/messages/email \
  -H "x-api-key: $RELAYIT_API_KEY" \
  -H "app: billing" \
  -H "environment: production" \
  -H "Content-Type: application/json" \
  -d '{"from":"billing@example.com","to":"jane@example.com","subject":"Invoice","text":"Your invoice is ready."}'
```

Send both or neither. One without the other returns `400 invalid_app_environment`. New pairs are created on first use. See [Concepts](/docs/concepts#apps-and-app-environments).

## Response

On success the API returns `201 Created`:

```json
{
  "id": "msg_01jbxk3c1ef6h8w2m4n9qz7r5t"
}
```

If some recipients were removed because they are suppressed, the response also lists them:

```json
{
  "id": "msg_01jbxk3c1ef6h8w2m4n9qz7r5t",
  "stripped": [
    { "email": "bounced@example.com", "reason": "suppression" }
  ]
}
```

`id` is the Message id. A `201` means the email was accepted and queued, not that it was delivered. Errors are described in [Errors and limits](/docs/errors-and-limits).

## Full example

```ts
const response = await fetch("https://api.relayit.io/messages/email", {
  method: "POST",
  headers: {
    "x-api-key": process.env.RELAYIT_API_KEY!,
    "Content-Type": "application/json",
    "Idempotency-Key": "order-1042-receipt",
    app: "shop",
    environment: "production",
  },
  body: JSON.stringify({
    from: "Acme Shop <orders@example.com>",
    to: [{ email: "jane@example.com", first_name: "Jane" }],
    bcc: "archive@example.com",
    reply_to: "support@example.com",
    subject: "Your receipt for order #1042",
    html: "<p>Thanks, Jane. Your invoice is attached.</p>",
    text: "Thanks, Jane. Your invoice is attached.",
    attachments: [
      {
        filename: "invoice-1042.pdf",
        path: "https://files.example.com/invoices/1042.pdf",
      },
    ],
    tags: [{ name: "category", value: "receipt" }],
    headers: { "X-Entity-Ref-ID": "order-1042" },
  }),
});

const result = await response.json();

if (response.status === 201) {
  console.log("Accepted", result.id, result.stripped ?? []);
} else if (response.status === 429) {
  console.log(`Limit reached, retry in ${result.retry_after_seconds}s`);
} else {
  console.error(response.status, result);
}
```
