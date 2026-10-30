---
title: "API keys"
description: "Create, expire, rotate, and delete the Project API keys that authenticate requests to the Relayit API."
---

## What an API key is

An API key authenticates requests to the send endpoints. Each key belongs to one Project and can only send for that Project. Keys start with `rel_org_`.

Pass the key in the `x-api-key` header:

```http
POST /messages/email HTTP/1.1
Host: api.relayit.io
x-api-key: rel_org_...
Content-Type: application/json
```

A missing, unknown, expired, or deleted key returns:

```json
{
  "code": "invalid_api_key",
  "message": "Invalid API key"
}
```

with status `403` on `/messages/email`. The legacy endpoints return `401` instead.

## Create a key

1. Open your Project in https://app.relayit.io.
2. Go to **Settings > API keys** and select **Create API Key**.
3. Enter a **Name** that tells you where the key is used, such as `production-backend` or `ci`.
4. Optionally turn on **Expires**. It defaults to 30 days from now. Use **Expires At** to pick another date. The key stops working at the end of that day.
5. Select **Create**.

The next screen shows the full key once. Copy it and select **I have copied my key**. Relayit only stores a hash, so you cannot view the key again later.

> **Warning:** Treat API keys like passwords. Keep them in server-side environment variables or a secrets manager. Never ship them in browser or mobile app code.

## Scoping

- A key is scoped to the Project it was created in. To send for another Project, create a key in that Project.
- A key can send from any verified Domain of its Project and from the Project's Sandbox Domain.
- Usage from every key in a Project counts toward the Plan of the Project's Billing User.

If you want separate keys per service or environment, create one key for each and give them clear names. To separate reporting, combine this with the `app` and `environment` headers (see [Sending email](/docs/sending-email#app-and-environment-attribution)).

## Manage keys

The API keys page lists every key with:

- Its name and the last few characters of the key.
- When it was created and who created it.
- When it was last used, or **Never used**.

You can search by name and sort by **Date Created**.

From a key's menu:

- **Edit Key** changes the name and the expiration date.
- **Delete Key** revokes the key immediately. You must type the key's name to confirm. Requests using it start failing with `invalid_api_key`.

## Rotate a key

Relayit does not have a single rotate action. To rotate without downtime:

1. Create a new key.
2. Deploy the new key to your application.
3. Check that the old key's **last used** time stops updating.
4. Delete the old key.

Rotate immediately if a key may have been exposed, for example if it was committed to a repository or printed in logs.
