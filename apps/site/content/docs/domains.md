---
title: "Domains"
description: "Send from your own domain: add it in the dashboard, publish DKIM, MAIL FROM, and DMARC records, and get it verified."
---

## Sandbox Domain vs custom Domains

Every email you send needs a sending identity. Relayit offers two.

| | Sandbox Domain | Custom Domain |
| --- | --- | --- |
| Who owns it | Relayit | You |
| Setup | None. New Projects are allocated to it when it is available. | Add it and publish DNS records. |
| From address | `sandbox@` the Sandbox Domain, only | Any address on the domain |
| Recipients | Project members only | Anyone |
| Provider | Managed | Managed or BYO |
| Use it for | Testing your integration | Production mail |

The Project keeps the Sandbox Domain after your own Domains verify, so you can keep using it for tests.

> **Note:** The Sandbox Domain is not listed on the Domains page. The [legacy send endpoints](/docs/legacy-send) use it automatically when you omit `from`.

## Add a Domain

1. In the dashboard, open **Settings > Domains**.
2. Select **Add Custom Domain**.
3. Enter the domain you want to send from, for example `example.com`. You can add a subdomain such as `mail.example.com` if you want to keep transactional mail separate from your main domain.
4. Pick an **Email provider**. The current default managed provider is preselected and labeled `default`. BYO Providers your Project owns are labeled `BYO`.
5. Select **Add Domain**.

Relayit generates a DKIM key for the domain, registers it with the Provider, and shows you the DNS records to publish.

A domain can only belong to one Project at a time. If another Project already holds it, see [Claiming a domain from another Project](#claiming-a-domain-from-another-project).

## DNS records

Open the Domain (select it in the list, or use **View Details** in its menu) to see the **DNS Records** section. Records are grouped into tables.

### DKIM and SPF (required)

These records authenticate your mail. With the default managed Provider (Amazon SES), they look like this:

```text
Type  Name                                 Content
TXT   <selector>._domainkey.example.com    p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQ...
MX    send.example.com                     feedback-smtp.<region>.amazonses.com   (priority 10)
TXT   send.example.com                     "v=spf1 include:amazonses.com ~all"
```

- The **DKIM** TXT record publishes the public key Relayit generated for your domain. The selector is unique to your Domain.
- The **MX** and **SPF** records on `send.` set up a custom MAIL FROM (return path) subdomain, so bounces come back through the Provider and SPF aligns with your domain.

Always copy the exact values from the dashboard. The selector, region, and record values depend on your Domain and its Provider.

### DMARC (optional)

```text
Type  Name                 Content
TXT   _dmarc.example.com   "v=DMARC1; p=none;"
```

DMARC is optional but strongly recommended. Many mailbox providers expect it for good inbox placement. If you already have a DMARC record, keep a single one. The dashboard warns you when it finds **Multiple DMARC records** on a host.

### Ownership (only when claiming)

```text
Type  Name                              Content
TXT   _relayit-challenge.example.com    "relayit-domain-verification=<token>"
```

This table only appears when you are claiming a domain that another Project holds.

## Verification

After you publish the records, select **Refresh** on the Domain page. Relayit also re-checks on its own: every few minutes while records are missing (backing off to every 15 minutes), and every 12 hours once the Domain is verified.

Each record shows its own status, and the Domain shows an overall status:

| Status | Meaning |
| --- | --- |
| **Not verified** | No records found yet. |
| **Partially verified** | Some records are in place, others are still missing. |
| **Verified** | All required records are in place and the Provider has verified the domain. |

The Domain header also shows **Can Send**. It is **Yes** only when the Domain is verified and not paused. Once it is, any address on that exact domain works as `from`.

DNS changes can take a while to propagate. If a record stays pending, check that you did not add your domain name twice (some DNS hosts append it automatically to the **Name** field).

## Paused Domains

A Domain can be paused, for example by Relayit because of a bad sending reputation, or by an administrator. A paused Domain shows a `paused` badge and **Can Send: No**.

While a Domain is paused:

- New sends from it fail with `422 invalid_from_address`.
- Emails that were already queued fail at send time. They are not held for later.

Pausing and unpausing are not available as dashboard actions yet. Contact support if one of your Domains is paused.

## Providers per Domain

Each Domain has one active Provider, chosen when you add it. Omitting a choice uses the current default managed Provider. The DNS records you publish belong to that Domain and Provider pairing, which is why the Domain page lists the Provider at the top.

Sends through a managed Provider count against your managed limits. Sends through a BYO Provider count against the higher BYO limits. See [Errors and limits](/docs/errors-and-limits#plan-limits).

## Claiming a domain from another Project

If you add a domain that another Project already holds, Relayit starts a claim instead of failing:

1. The Domain appears in your list with a `claim pending` badge.
2. The Domain page shows an **Ownership** table with a `_relayit-challenge` TXT record.
3. Publish that record and select **Refresh**.

When ownership verifies, the domain moves to your Project and the other Project loses it. If another Project already has a pending claim on the same domain, adding it fails until that claim is resolved.

## Delete a Domain

Open the Domain menu and choose **Delete Domain**, then type the domain name to confirm. Deleting frees the domain so it can be added again. Emails already queued from it fail at send time. Past Messages keep their original `from`.
