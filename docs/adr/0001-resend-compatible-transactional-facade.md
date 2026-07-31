# Resend-compatible transactional email API

Transactional email sending is exposed as `/messages/email`, shaped to match Resend’s send-email API so adopters can point their client at Relayit with minimal change. Optional Relayit-only properties may be added alongside the Resend-compatible fields; they must not be required for a basic Resend-shaped send. This surface creates a Message (Purpose=transactional) and an email Delivery — it is not a second domain concept and does not cover Campaigns or Campaign Sends.

**Deliberate incompatibilities with Resend:**
- Optional `topic_id` on send-email is not supported. Topic consent applies only on the marketing path (Campaign → Campaign Send). One-to-one marketing must use Campaign Send, not `/messages/email`.
- Webhook event *type names* are channel-agnostic (`delivery.*`, `message.*`, `domain.*`, `contact.*`), not Resend’s `email.*` strings. We support the same *categories* of events (delivery outcomes, domain lifecycle, contact lifecycle), not drop-in webhook type compatibility. Inbound receive is out of scope for now.
