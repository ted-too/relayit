---
title: "Concepts"
description: "How Projects, Domains, Templates, Contacts, Messages, and Plans fit together in Relayit."
---

## Projects

A Project is the main tenant boundary in Relayit. Everything you send with belongs to a Project: Domains, API keys, Templates, Contacts, and Messages.

- A user can belong to several Projects. Each Project has an owner and members with roles.
- Each Project has a name and a slug. You can edit both under **Settings > Project details**. The slug is used in the [legacy send endpoints](/docs/legacy-send).
- API keys are created inside a Project and can only send for that Project.
- Deleting a Project (in the **Danger Zone** on the Project details page) removes its Project-scoped data and frees its Domains so they can be added elsewhere. Usage already consumed is not refunded.

## Apps and App Environments

Apps and App Environments are optional attribution labels inside a Project. They let you tell apart sends from, say, your `billing` app in `staging` and in `production`, without creating separate Projects.

You set them per request with two headers:

```http
app: billing
environment: production
```

Rules:

- Send both headers or neither. Sending only one returns `400 invalid_app_environment`.
- You do not need to create them first. The first send with a new pair creates it.
- Without the headers, the send is attributed to the Project itself.
- Contacts are tracked at the furthest scope you use. A recipient sent to with `app` and `environment` set is a separate Contact from the same address sent to without them.

## Domains and the Sandbox Domain

To send email you need a sending identity. Relayit has two kinds.

**Domain.** A domain you own, added to one Project. You prove ownership and set up authentication by adding DNS records (DKIM, SPF, and optionally DMARC). Once verified, you can send from any address on that exact domain. A Domain can be paused, and a paused Domain rejects new sends.

**Sandbox Domain.** A shared, Relayit-owned domain. New Projects are allocated to it when it is available, so you can send right away from `sandbox@` the Sandbox Domain. Sandbox sends can only go to email addresses of the Project's members. The Project keeps the Sandbox Domain even after its own Domains verify.

See [Domains](/docs/domains) for the setup flow.

## Amazon SES

Relayit sends email through Amazon SES, on an SES account it runs; you never handle SES credentials. When you add a Domain, Relayit registers it with SES and shows you the DNS records SES needs. Each Project's sending reputation is kept apart on that account, so another Project's bounces and complaints never pause your mail.

## Templates

A Template is reusable email content stored in your Project. You send it by passing its id (`tmpl_...`) or its slug in the `template` field, along with variables.

Relayit supports two template engines:

- **React Email.** You write a React Email component in the hosted editor (the Email Workspace), publish it, and link it to a Template. Variables are passed as component props.
- **Primitive.** Plain `subject`, `html`, and `text` with `{{{VARIABLE}}}` placeholders, compatible with Resend's template syntax. The send endpoint already renders primitive Templates, but there is no dashboard editor or API for creating them yet. That is coming soon.

Archived Templates cannot be used for new sends. See [Templates](/docs/templates).

## Contacts, suppression, and topics

A Contact is a recipient address that Relayit tracks inside a Project (or inside an App Environment, if you send with attribution headers).

What exists today:

- **Contacts are created from sends.** When you send to a recipient, Relayit creates or updates the Contact. If you pass a Contact object, its `first_name`, `last_name`, and `properties` are stored.
- **Automatic suppression.** When SES reports a hard bounce or a complaint, Relayit suppresses that address. Hard bounces suppress the address for all mail. Complaints suppress it for marketing mail.
- **Suppressed recipients are stripped.** On a transactional send, any recipient suppressed for all mail is removed and listed in the `stripped` array of the response. If every recipient is suppressed, the send fails with `all_recipients_suppressed`.

Coming soon: a Contacts screen in the dashboard, manual suppression management, Topics for marketing consent, and Segments for targeting.

## Messages and Deliveries

Every accepted `POST /messages/email` request creates:

- A **Message** with an id like `msg_...`. This is the id returned in the response.
- One email **Delivery** that carries the Message to SES. One Delivery covers all recipients of that request.

Messages created through `/messages/email` are always transactional. Marketing sends will go through Campaigns, which are coming soon.

Delivery happens in the background. A `201` means the Message was accepted and queued, not that it reached the inbox. If a Domain is paused or removed after a send was queued, the queued Delivery fails at send time.

## Usage and Plans

On Relayit Cloud, a Plan sets your limits. Usage is counted per Delivery (one per accepted send, regardless of recipient count), separately for transactional and marketing sends.

Plan limits belong to a user, the Project's **Billing User**. By default that is the Project owner. Every Project that user is Billing User for draws from the same limits. Monthly limits reset with the user's billing period. Daily limits reset at midnight UTC.

When a limit is reached, sends return `429` with `retry_after_seconds`. See [Errors and limits](/docs/errors-and-limits) for the full Plan table.

Self-hosted installs have no Plans. Every limit is unlimited.
