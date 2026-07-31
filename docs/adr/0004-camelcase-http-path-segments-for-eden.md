# CamelCase HTTP path segments for Eden Treaty

Public HTTP path segments use **camelCase** (e.g. `/apiKeys`, `/webhookEndpoints`), not kebab-case (`/api-keys`, `/webhook-endpoints`).

Eden Treaty maps URL segments to client property access (`api.apiKeys.get()`, `api.webhookEndpoints.post()`). Hyphenated segments are awkward or unusable as identifiers in that client. CamelCase keeps the HTTP surface and the typed Eden client aligned.

This applies to multi-word path segments on the API. Single-word segments stay lowercase plurals as usual (`/messages`, `/domains`). Nested resources follow the same rule (`/messages/email` is fine; a multi-word nest would be `/messages/emailBatch` if introduced).

**Channel-scoped Project resources** (e.g. email Domains / Sandbox Domain) live under `/projects/:orgSlug/channels/{channel}/…` so later channels can mount parallel trees. Eden then reads as `api.projects({ orgSlug }).channels.email.domains`. **Project BYO Providers** live under `/projects/:orgSlug/providers` (universal across channels, not nested under `/channels/…`). **Ops managed backends** live under `/admin/providers`. **Provider notification ingress** (vendor SNS / config-set callbacks — not Project Webhook Endpoints) lives under `/webhooks/providers/:vendorId/:productId`.

File names under `server/routes/` may stay kebab-case (`api-keys.ts`, `webhook-endpoint.ts`); only the HTTP `prefix` needs to be camelCase.
