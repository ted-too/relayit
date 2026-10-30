---
title: "Quickstart"
description: "Create a Project, get an API key, and send your first email through the Relayit API."
---

## 1. Create an account

Go to https://app.relayit.io and choose **Sign Up**. You can sign up with email and password, or with GitHub if the button is shown.

## 2. Create a Project

After sign-up you land on **Create Project**. Enter a name and select **Create Project**.

Relayit generates a slug for the Project from its name. You can change the name and slug later under **Settings > Project details**.

When the Project is created, Relayit allocates it to the platform Sandbox Domain if one is available. This lets you send test emails before you set up your own Domain.

## 3. Choose a sending address

You have two options.

### Option A: the Sandbox Domain (testing only)

Sandbox sends use the sender `sandbox@` followed by the Sandbox Domain. Two rules apply:

- The `from` address must be exactly the sandbox address.
- Every recipient (`to`, `cc`, and `bcc`) must be the email address of a member of your Project. Any other recipient fails with `sandbox_recipient_not_member`.

Use the Sandbox Domain to check that your integration works. Do not use it for real users.

### Option B: your own Domain

1. Open **Settings > Domains** and select **Add Custom Domain**.
2. Enter the domain you want to send from, for example `example.com`, and pick an email provider. The default managed provider is preselected.
3. Select **Add Domain**, then open the Domain to see its DNS records.
4. Add the records at your DNS host and select **Refresh** until the status is **Verified** and **Can Send** shows **Yes**.

After that you can send from any address on that domain, such as `hello@example.com`. See [Domains](/docs/domains) for details on each record.

## 4. Create an API key

1. Open **Settings > API keys** and select **Create API Key**.
2. Give it a name, such as `local-dev`. Optionally turn on **Expires** and pick a date.
3. Select **Create** and copy the key. It starts with `rel_org_`. You will not be able to see it again.

Store the key in an environment variable:

```bash
export RELAYIT_API_KEY="rel_org_..."
```

## 5. Send an email with curl

```bash
curl -X POST https://api.relayit.io/messages/email \
  -H "x-api-key: $RELAYIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "Acme <hello@example.com>",
    "to": "you@example.com",
    "subject": "Hello from Relayit",
    "html": "<p>It works.</p>",
    "text": "It works."
  }'
```

A successful request returns `201 Created`:

```json
{
  "id": "msg_01jbxk3c1ef6h8w2m4n9qz7r5t"
}
```

## 6. Send an email with TypeScript

This uses the built-in `fetch`, so it runs on Node.js 18+, Bun, Deno, and edge runtimes.

```ts
const response = await fetch("https://api.relayit.io/messages/email", {
  method: "POST",
  headers: {
    "x-api-key": process.env.RELAYIT_API_KEY!,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    from: "Acme <hello@example.com>",
    to: ["you@example.com"],
    subject: "Hello from Relayit",
    html: "<p>It works.</p>",
  }),
});

if (response.status !== 201) {
  const error = await response.json();
  throw new Error(`Send failed (${response.status}): ${JSON.stringify(error)}`);
}

const { id } = (await response.json()) as { id: string };
console.log("Accepted message", id);
```

## 7. Check the result

A `201` response means Relayit accepted the email, stored a Message, and queued the Delivery. Check the recipient's inbox (and spam folder) to confirm it arrived.

If the response contains a `stripped` array, some recipients were removed because they are suppressed. See [Sending email](/docs/sending-email#response).

If you get an error, the body has a `code` that tells you what went wrong. The most common first-send errors are:

| Code | Fix |
| --- | --- |
| `invalid_api_key` | Check the `x-api-key` header and that the key has not expired or been deleted. |
| `invalid_from_address` | The `from` domain is not a verified, unpaused Domain of this Project, and is not the sandbox address. |
| `sandbox_recipient_not_member` | Sandbox sends can only go to Project members. Verify your own Domain to send to anyone. |

The full list is in [Errors and limits](/docs/errors-and-limits).

> **Note:** A message history view in the dashboard and outbound webhooks for delivery events are coming soon. For now, the inbox is the place to confirm delivery.

## Next steps

- [Sending email](/docs/sending-email): attachments, templates, scheduling, tags, and idempotency.
- [Templates](/docs/templates): reuse email content and fill it with variables.
- Try requests in the interactive reference at https://api.relayit.io/docs.
