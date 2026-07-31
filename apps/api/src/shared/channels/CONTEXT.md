# Channels

How a project sends messages. A project may send the same logical message on multiple channels, each with its own format.

## Language

**Channel**:
A delivery medium a project can use to send (e.g. Email, SMS, WhatsApp).
_Avoid_: Integration, provider (a provider is a vendor *within* a channel)

**Channel Format**:
The channel-specific content for a send (e.g. HTML for email, text for SMS) when the same message goes out on more than one channel. May live inline on a Message/Campaign, or as a **per-channel variant** on a **Template** (Template is the id-addressed container; each channel may have its own variant/engine).
_Avoid_: Template (Template is the reusable container; Channel Format is the per-channel payload), body (too generic)

**Provider**:
A delivery-vendor capability a Project uses for a Channel (managed or customer-connected). Same noun on every channel. Relayit helps with setup required to send; it does not fully proxy the provider’s control plane. Both managed and customer-connected Providers meter Usage; customer-connected (BYO) is billed substantially cheaper on the Plan. **BYO Providers are Project-owned** (same tenancy as Domains) — credentials do not span Projects; delete the Project and they go with it. Adding a BYO Provider is **edition-split**: cloud uses the Billing User’s Plan `byoProviders` entitlement; self-hosted has no Plans — entitlements behave as unlimited (**BYO always allowed**). In cloud, if entitlement is later lost, existing BYO Providers and Domain↔BYO pairings remain, but sends that would use BYO are rejected as **billing limits reached** until the Project moves the Domain off BYO. For email, when multiple managed backends exist, ops marks one as **default**. Domain create (including claim/transfer) and additive pairings may choose a managed backend or BYO; omitting a choice uses the **current** ops default. On claim, choosing the same managed backend as the source keeps DNS; a different choice tears down and requires new DNS. With only one managed backend, that choice is implicit. BYO Providers are added by the Project later and may be removed freely. Platform/admin wiring of managed vendor accounts (including marking the **default** managed backend) is an ops concern — **not** a separate product noun (no “Platform Provider” in the glossary). Ops **cannot delete** a managed backend while any Domain or Sandbox pairing still references it.
_Avoid_: Integration, connection (as the product noun), channel; Platform Provider (as a glossary noun); User-owned BYO shared across Projects; per-Project sticky managed Provider store

## Per-channel contexts

Concrete channels are their own contexts under Channels. Inside a channel context, **Providers**, **Deliverability**, and **Sending Identity** are modules — not separate bounded contexts.

**Sending Identity** (module, all channels): setup required to send *as* / *from*. User-facing nouns are channel-specific concrete entities (Email: **Domain**, **Sandbox Domain**; SMS: phone number, sender ID, etc.) — not a single umbrella product noun. Verification / registration is per Provider (Sandbox Domain is the exception: usable without customer Domain verification).
