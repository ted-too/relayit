# Email

First concrete channel. Tenants send email through Relayit using managed or BYO Providers and a sending identity (a customer Domain, or the platform Sandbox Domain).

## Language

**Provider**:
Credentials used to talk to an upstream email vendor (e.g. SES). Managed Providers are platform-owned; BYO Providers are Project-owned.
_Avoid_: integration, backend, vendor account (except as informal speech)

**Domain**:
A Project-scoped customer sending FQDN. One FQDN; Resend-style DNS per Provider pairing; one active Provider plus optional failover-eligible pairings; may be paused.
_Avoid_: sending domain

**Sandbox Domain**:
The platform-owned shared sending root — the Cloudflare zone root. At most one. A Project is allocated to it (≤1 per Project) and keeps it after customer Domains verify.
_Avoid_: per-Project sandbox hostname
