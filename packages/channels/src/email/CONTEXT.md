# Email

First concrete channel. Tenants send email through Relayit using managed or BYO Providers and a sending identity (a customer Domain, or the platform Sandbox Domain).

## Language

**Provider**:
Credentials used to talk to an upstream email vendor (e.g. SES). Managed Providers are platform-owned; BYO Providers are Project-owned. Create and delete provision and tear down that vendor's delivery-event infrastructure; API startup re-ensures every email Provider.
_Avoid_: integration, backend, vendor account (except as informal speech)

**Domain**:
A Project-scoped customer sending FQDN. One FQDN; Resend-style DNS per Provider pairing; one active Provider plus optional failover-eligible pairings; may be paused.
_Avoid_: sending domain

**Sandbox Domain**:
The platform-owned shared sending root — the Cloudflare zone root. At most one. A Project is allocated to it (≤1 per Project) and keeps it after customer Domains verify.
_Avoid_: per-Project sandbox hostname

**Project Sending Pause**:
A managed Provider's vendor-side pause of one Project's sending (SES: the Project's tenant was paused by its reputation policy or by hand). Each send on a managed Provider names the sending Project and identity so the vendor tracks reputation per Project; BYO Providers send without it. A send that hits a Project Sending Pause fails terminally: no retry, no failover to another Provider, and the Provider circuit is not tripped (other Projects keep sending). The Domain is paused with reason `bad_reputation`; the Sandbox Domain is shared and is not paused.
_Avoid_: tenant (outside SES adapter code), account pause
