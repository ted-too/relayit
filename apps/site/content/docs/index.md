---
title: "Introduction"
description: "Relayit is a multi-tenant messaging platform. Send transactional email through one API, on Relayit Cloud or your own servers."
---

## What Relayit is

Relayit is a messaging platform for developers. You send messages to your users through one HTTP API, and Relayit handles sending identities, delivery providers, templates, suppression, and usage tracking.

Email is the first live channel. SMS and other channels are planned, but they are not available yet. Everything in these docs describes email.

The transactional send endpoint, `POST /messages/email`, is shaped to match Resend's send-email API. If you already send through Resend, you can usually point your client at `https://api.relayit.io` and swap the auth header. See [Sending email](/docs/sending-email) for the differences.

## Cloud or self-hosted

You can use Relayit in two ways.

| | Relayit Cloud | Self-hosted |
| --- | --- | --- |
| Dashboard | https://app.relayit.io | Your own web container |
| API | https://api.relayit.io | Your own api container |
| Plans and send limits | Free, Signal, Broadcast | None, everything is unlimited |
| Sign-in | Email and password, GitHub when enabled | Email and password |
| Managed email provider and Sandbox Domain | Provided by Relayit | Only if you configure them |

Self-hosting is covered in [Self-hosting](/docs/self-hosting).

## Core nouns

**Project.** The tenant boundary. Domains, API keys, Templates, Contacts, and Messages all belong to one Project. A user can be a member of several Projects.

**App and App Environment.** Optional labels for attribution inside a Project, such as app `billing` in environment `production`. You set them per request with the `app` and `environment` headers.

**Domain.** A domain you own (for example `example.com`) that you verify with DNS records so you can send from addresses on it.

**Sandbox Domain.** A Relayit-owned sending domain that a new Project is allocated to, so you can try sending before you verify your own Domain. Sandbox sends can only go to members of your Project.

**Provider.** The upstream email vendor that actually delivers your mail. Managed Providers are run by Relayit. Bring-your-own (BYO) Providers use your own vendor account.

**Template.** A reusable email, addressed by id (`tmpl_...`) or slug, that you fill with variables at send time.

**Message and Delivery.** Each successful send creates a Message (id `msg_...`) and one email Delivery that carries it to the Provider.

**Contact.** A recipient address that Relayit tracks inside a Project, including suppression after hard bounces and complaints.

**API key.** A secret, scoped to one Project, that authenticates send requests in the `x-api-key` header.

## Where to go next

- [Quickstart](/docs/quickstart): send your first email in a few minutes.
- [Concepts](/docs/concepts): how the pieces fit together.
- [Sending email](/docs/sending-email): every field of `POST /messages/email`.
- [Errors and limits](/docs/errors-and-limits): status codes, error codes, and plan limits.
- Interactive API reference: https://api.relayit.io/docs
- OpenAPI spec: https://api.relayit.io/openapi.json
