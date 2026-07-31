# Tenancy

Who can use Relayit and under what project boundary. Auth and API keys are handled by Better Auth; this context owns the product meaning of those entities.

## Language

**User**:
A person with a Relayit account. A user has a plan and may belong to one or more projects.
_Avoid_: Account, customer (as the login entity)

**Plan**:
The subscription tier attached to a User that governs product entitlements. Send limits (and pricing) are dimensioned by **Purpose × Channel**, and further by whether the Delivery uses a **managed** or **customer-connected (BYO)** Provider — BYO is metered and billed substantially cheaper than managed. Plans may also cap how many email **Domains** a Project may hold (`customDomains`) — a pending claim counts on the destination; on successful transfer the destination keeps the slot and the source frees one. **Whether a Project may add BYO Providers** (and thus Domain↔BYO pairings) is edition-split: in **cloud**, Plan-gated via an email Plan entitlement (`byoProviders`) — matrix lives with Plan limits and may change; currently only the highest paid tier enables it. **Self-hosted has no Plans / Plan logic** and gets the full feature set — entitlements behave as an unlimited Plan (including BYO always allowed); do not run cloud Plan packaging. In cloud, if entitlement is lost while BYO Providers / Domain↔BYO pairings still exist, those rows remain but **BYO cannot be used to send** until the Project moves the Domain’s send path off BYO (e.g. switch active to managed); Accepts that would use BYO are rejected in the same **billing-limits-reached** shape as a quota exceed (not a separate “detach everything” cleanup). A Project’s sends draw from its **Billing User**’s Plan/Usage buckets (not necessarily the acting member’s). Exceeding a bucket rejects the send request entirely (no partial fill, no overage until a richer Billing context exists). Payment-provider details (Stripe objects, invoices) are out of this glossary until a Billing context exists.
_Avoid_: Tier, package, subscription (as a synonym for Plan — Subscription may appear later under Billing)

**Billing Period**:
The window over which Purpose×Channel (and managed vs BYO) Usage is accumulated and reset for a User’s Plan (cloud). For Users with an active Plan subscription, the window follows that subscription’s period; for free Users, the window rolls from account creation (`user.createdAt`). Not the calendar month. Limits apply per Billing Period. Self-hosted has no Plan packaging — entitlements behave as unlimited.
_Avoid_: Cycle, calendar month (as the period definition)

**Project**:
The primary tenant boundary. Implemented as an organization in Better Auth. May optionally contain Apps and App Environments for finer scope. Has an **Owner** and a **Billing User** (defaults to the Owner; may be reassigned). Creating a Project provisions its email **Sandbox Domain** (see Channels / Email). **BYO Providers** are Project-owned and added later by the Project. **Delete** (by Owner) removes the Project and its Project-scoped product data; attached **Domains** and BYO Providers are removed (FQDNs freed); the Sandbox Domain ends with the Project. Usage already consumed in the current Billing Period stays on the Billing User’s ledger (no clawback).
_Avoid_: Organization, workspace, tenant (in product language — prefer Project)

**Owner**:
The User who owns a Project (membership/admin role). Distinct from Billing User when payer and owner differ.
_Avoid_: Admin (a permission, not the ownership noun), Billing User

**Billing User**:
The User whose Plan and Usage buckets a Project draws from for send entitlements. Must be a member of the Project. Defaults to the Project Owner; may be reassigned mid-cycle. Reassignment is instant for future sends — past Usage stays on the previous Billing User’s ledger (no transfer). Cannot leave or be removed from the Project while they are Billing User — reassign first. Not necessarily the member whose API key performed the send.
_Avoid_: Payer, customer (as the product noun), Owner (related but distinct)

**App**:
An optional product or surface inside a Project (e.g. checkout service vs marketing site). Often unset (`null`); used when a Project runs multiple services and needs to distinguish who sent what. Not a separately persisted entity — it is the `app` value on one or more **App Environment** pairs. There is no management create for App; pairs appear via send. Grouping or bulk-delete by App name (if offered) is a view over App Environment rows.
_Avoid_: Application, service (as the product noun), Project

**App Environment**:
An optional deploy stage under an App (e.g. staging, prod). Often unset (`null`); used with App so staging traffic and contacts stay distinct from production. Persisted as a Project-scoped `(app, environment)` pair (both may be null for the Project default). **Not** created via a management API — materialised on send when App / Environment **headers** are supplied (or the default pair when omitted). Not accepted as JSON body fields or Message Tags on send APIs. On Accept, the two headers are an **all-or-nothing pair**: both present, or neither; a partial pair is rejected. **Delete** hard-deletes that pair and cascades scoped data (e.g. Contacts, Messages in that scope); Project-scoped entities (Domains, BYO Providers, Campaigns, Topics, Templates, Email Workspace / Workspace Entries, …) are untouched. The Project-default pair (`app` and `environment` both null) **cannot** be deleted.
_Avoid_: Stage, env (as the product noun), Environment alone

**API Key**:
A credential scoped to a Project, used to authenticate send and management API calls. Not scoped to App or App Environment. Sends authenticated by any Project API key still consume the Project’s Billing User quotas.
_Avoid_: Token, secret (as the product noun)
