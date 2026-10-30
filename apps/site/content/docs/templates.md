---
title: "Templates"
description: "Build reusable emails with React Email in the Relayit dashboard and send them by id or slug with variables."
---

## How Templates work

A Template is a reusable email stored in your Project. Instead of sending `html` and `text` on every request, you send a reference to the Template and the values to fill in.

Every Template has:

- A **name**, the label you see in the dashboard. Names do not have to be unique.
- A **slug**, generated from the name and unique among active Templates in the Project. You can edit it.
- An **id** that starts with `tmpl_`. It never changes.
- An **email channel** that holds the subject and the content.

You can send with either the id or the slug. Use the id if you want references that survive slug changes. Use the slug if you want readable code.

## Template engines

| Engine | Content | Variables | Where you author it |
| --- | --- | --- | --- |
| React Email | A React component in the Email Workspace | Component props, any JSON shape | Dashboard |
| Primitive | `subject`, `html`, `text` with `{{{NAME}}}` placeholders | Flat string or number values | Coming soon |

The dashboard currently authors React Email Templates. The send endpoint also renders primitive Templates (Resend-compatible placeholder syntax), but there is no editor or API for creating them yet.

## Create a Template in the dashboard

1. Open **Automations > Templates** and select **Create Template**.
2. Enter a name, for example `Welcome email`, and select **Create**. Relayit generates a slug such as `welcome-email`.
3. On the Template page, the **Slug** section lets you change the slug. Select **Save slug** to apply it.

The Template page header shows the name, the slug, and a reminder that you can send with the slug or the id.

## Author the email with React Email

The email content lives in your Project's **Email Workspace**, a hosted editor for React Email components. Each component file is a Workspace **Entry** under `reactEmail/`, for example `reactEmail/welcome-email.tsx`.

### Set the subject

In the **Email channel** section of the Template page, fill in **Subject**. The subject belongs to the Template, not to the React component. A send request can still override it with `subject`.

### Create or pick an Entry

- **Create new Entry** opens the workspace with a starter component for this Template.
- **Pick Entry** links an existing Entry. Only Entries that have been published are pickable.
- **Open in editor** opens the linked Entry.

A new Entry starts like this:

```tsx
import * as React from "react";
import { Html, Body, Text } from "@react-email/components";

export type Props = {
  name: string;
};

export default function WelcomeEmail({ name }: Props) {
  return (
    <Html>
      <Body>
        <Text>Welcome, {name}!</Text>
      </Body>
    </Html>
  );
}
```

### Save, preview, publish

The workspace toolbar has three actions:

- **Save** stores your changes as a draft (also `Cmd+S` or `Ctrl+S`).
- **Preview** renders the Entry with the JSON in the **Props** panel, so you can check the output with sample data.
- **Publish** builds the workspace into a sealed artifact. When you opened the workspace from a Template, Publish also links the Entry to it.

Drafts are never sent. A send uses the artifact from the last successful Publish. If you edit and save without publishing, sends keep using the previous version.

The status badge on the Template's email channel tells you where things stand: **Linked**, **Not linked**, or **Broken** (the linked Entry was removed).

## Send a Template

Pass `template` instead of `html` and `text`:

```bash
curl -X POST https://api.relayit.io/messages/email \
  -H "x-api-key: $RELAYIT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "Acme <hello@example.com>",
    "to": "jane@example.com",
    "template": {
      "id": "welcome-email",
      "variables": { "name": "Jane" }
    }
  }'
```

Or by id, with a subject override:

```json
{
  "from": "Acme <hello@example.com>",
  "to": "jane@example.com",
  "subject": "Welcome aboard, Jane",
  "template": {
    "id": "tmpl_01jbxm5q8hf2c4v7k9d3t6w1ra",
    "variables": { "name": "Jane" }
  }
}
```

For a React Email Template, `variables` is passed to the component as props. Nested objects and arrays are fine:

```json
{
  "template": {
    "id": "order-shipped",
    "variables": {
      "customer": { "first_name": "Jane" },
      "items": [
        { "name": "Desk lamp", "quantity": 1 },
        { "name": "Bulb", "quantity": 2 }
      ]
    }
  }
}
```

## Primitive Template variables

Primitive Templates use triple-brace placeholders such as `{{{PRODUCT}}}`. Each variable declared on the Template has a type (`string` or `number`) and an optional fallback. At send time:

- A provided value must match the declared type, or the send fails with `type_mismatch`.
- A missing value uses the fallback. With no fallback, the send fails with `missing_variable`.
- A placeholder that is not declared on the Template fails with `undeclared_placeholder`.

## Archived Templates

Archive a Template with **Archive** in its menu in the Templates list. Archived Templates:

- Cannot be used for new sends. Sending one returns `template_not_found`.
- Cannot be edited or unarchived. Create a new Template to send again.
- Free up their slug, so a new Template can reuse it.

## Template errors

All of these return `422` with the `code` shown. See [Errors and limits](/docs/errors-and-limits) for the response shape.

| Code | Cause |
| --- | --- |
| `template_not_found` | No active Template with that id or slug in this Project. |
| `missing_email_variant` | The Template has no email channel set up. |
| `broken_react_email_link` | The linked Workspace Entry was removed. Pick another Entry. |
| `missing_react_email_artifact` | The Entry has never been published. Publish the workspace. |
| `missing_subject` | No subject on the Template and none in the request. |
| `react_email_render_failed` | The component threw while rendering. `details.detail` has the renderer message. |
| `invalid_primitive_content` | A primitive Template is missing its subject. |
| `missing_variable` | A primitive variable has no value and no fallback. `details.variable` names it. |
| `type_mismatch` | A primitive variable has the wrong type. `details.variable` names it. |
| `undeclared_placeholder` | A primitive placeholder is not declared. `details.variable` names it. |
