---
title: "Errors and limits"
description: "Every status code and error code returned by POST /messages/email, plus send limits for each Relayit Cloud plan."
---

## Response shapes

`POST /messages/email` returns `201` on success. Errors use one of three JSON shapes.

**Relayit error.** Most errors have a stable `code` you can branch on:

```json
{
  "code": "invalid_from_address",
  "message": "The 'from' address is not a verified sending domain for this Project."
}
```

Some `422` errors also carry a `details` object (see [Error details](#error-details)).

**Validation error.** Requests that fail schema checks return `422` with `type: "validation"` instead of `code`:

```json
{
  "type": "validation",
  "on": "body",
  "message": "subject is required when sending inline html/text"
}
```

Schema failures (wrong types, unknown fields, more than 50 recipients, a missing `x-api-key` header) use the same `type: "validation"` shape and include extra fields describing the failing property.

**Limit error.** `429` responses add `retry_after_seconds`.

Treat `message` as human-readable text that may change. Branch on `code` or `type`.

## Status codes

| Status | `code` | When |
| --- | --- | --- |
| `201` | | Accepted. Body is `{ "id": "msg_..." }`, plus `stripped` if any recipients were removed. |
| `400` | `invalid_app_environment` | Only one of the `app` and `environment` headers was sent. |
| `403` | `invalid_api_key` | The key is missing from the store, expired, deleted, or its Project no longer exists. |
| `422` | (validation) | The body or headers failed validation. See [Validation messages](#validation-messages). |
| `422` | see below | The request was valid but could not be accepted. |
| `429` | `daily_limit_exceeded` | The daily send limit for this bucket is used up. |
| `429` | `monthly_limit_exceeded` | The monthly send limit for this bucket is used up. |
| `500` | `internal_server_error` | Something failed on our side. Safe to retry with the same `Idempotency-Key`. |

## Validation messages

These come back as `422` with `type: "validation"` and `on: "body"`:

| `message` | Fix |
| --- | --- |
| `Invalid from address` | `from` must be `email@domain` or `Name <email@domain>`. |
| `Provide either inline html/text or template, not both (and not neither).` | Send `html`/`text` or `template`, never both. |
| `subject is required when sending inline html/text` | Add a non-empty `subject`. |
| `scheduled_at must be a parseable date (ISO 8601 preferred)` | Use a date like `2026-11-02T09:00:00Z`. |
| `This file type isn't allowed for security reasons.` | Remove or rename the blocked attachment. |

## Accept errors (422)

These have a `code` and mean the request was well-formed but Relayit could not accept it.

| `code` | Meaning |
| --- | --- |
| `invalid_from_address` | The `from` domain is not a verified, unpaused Domain of this Project, and it is not the active sandbox address. |
| `sandbox_recipient_not_member` | You sent from the Sandbox Domain to someone who is not a member of the Project. |
| `no_recipients` | `to`, `cc`, and `bcc` were all empty. |
| `all_recipients_suppressed` | Every recipient is suppressed for all mail, so nothing could be sent. |
| `invalid_attachment` | An attachment is blocked, too large, not valid base64, or could not be fetched. See `details.reason`. |
| `template_not_found` | No active Template with that id or slug exists in this Project. |
| `missing_email_variant` | The Template has no email channel. |
| `invalid_primitive_content` | The primitive Template has no subject. |
| `missing_variable` | A primitive Template variable has no value and no fallback. |
| `type_mismatch` | A primitive Template variable has the wrong type. |
| `undeclared_placeholder` | The primitive Template uses a placeholder it does not declare. |
| `broken_react_email_link` | The Template points at a Workspace Entry that no longer exists. |
| `missing_react_email_artifact` | The linked Workspace Entry has never been published. |
| `missing_subject` | The React Email Template has no subject and the request did not set one. |
| `react_email_render_failed` | The React Email component failed to render. |

### Error details

When present, `details` contains some of these fields:

| Field | Used by | Description |
| --- | --- | --- |
| `filename` | `invalid_attachment` | The attachment that failed. |
| `reason` | `invalid_attachment` | `blocked_extension`, `exceeds_size_limit`, `invalid_base64`, or `fetch_failed`. |
| `max_bytes` | `invalid_attachment` | The size limit in bytes (10485760) when `reason` is `exceeds_size_limit`. |
| `status` | `invalid_attachment` | The HTTP status returned by the attachment URL when `reason` is `fetch_failed`. |
| `variable` | `missing_variable`, `type_mismatch`, `undeclared_placeholder` | The variable name. |
| `detail` | `react_email_render_failed` | The renderer's error message. |

Example:

```json
{
  "code": "invalid_attachment",
  "message": "Attachment exceeds the size limit.",
  "details": {
    "filename": "video.mp4",
    "max_bytes": 10485760,
    "reason": "exceeds_size_limit"
  }
}
```

## Limit errors (429)

```json
{
  "code": "monthly_limit_exceeded",
  "message": "Monthly email send limit exceeded",
  "retry_after_seconds": 864000
}
```

`retry_after_seconds` is the time until the limit resets: the next midnight UTC for daily limits, or the end of the billing period for monthly limits. Do not retry before then. On Relayit Cloud you can raise your limits by moving to a higher Plan.

## Retrying safely

- Retry `500` responses and network errors with exponential backoff. Always send an `Idempotency-Key` so a retry never sends the email twice.
- Do not retry `400`, `403`, or `422` without changing the request.
- For `429`, wait `retry_after_seconds`.

## Plan limits

On Relayit Cloud, each user has a Plan. The Plan of a Project's Billing User applies to every Project that user is Billing User for.

Usage is counted per Delivery: one per accepted send, however many recipients it has. Limits are tracked separately for each combination of purpose (transactional or marketing) and Provider kind (managed or BYO). A blank daily limit means no daily cap.

| | Free | Signal | Broadcast |
| --- | --- | --- | --- |
| Projects | 1 | 3 | 5 |
| Data retention | 7 days | 30 days | 90 days |
| Custom Domains | 1 | Unlimited | Unlimited |
| BYO Providers | No | No | Yes |
| Transactional, managed: monthly | 2,500 | 40,000 | 200,000 |
| Transactional, managed: daily | 80 | | |
| Transactional, BYO: monthly | 10,000 | 200,000 | 1,000,000 |
| Transactional, BYO: daily | 500 | | |
| Marketing, managed: monthly | 500 | 10,000 | 50,000 |
| Marketing, managed: daily | 20 | | |
| Marketing, BYO: monthly | 2,000 | 50,000 | 250,000 |
| Marketing, BYO: daily | 100 | | |

Notes:

- `POST /messages/email` always sends transactional email. Marketing limits apply to Campaigns, which are coming soon.
- BYO limits only matter on Broadcast, the Plan that allows BYO Providers.
- Self-hosted installs have no Plans. Every limit above is unlimited.
