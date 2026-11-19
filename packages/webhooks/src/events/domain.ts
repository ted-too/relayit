import { Schema } from "effect";
import { defineWebhookEvent, type WebhookEventInput } from "./definition";

const domainStatus = Schema.Literals(["not_verified", "partially_verified", "verified"]);

const domainPayload = Schema.Struct({
  domain_id: Schema.String,
  status: domainStatus,
});

export const domainCreated = defineWebhookEvent({
  payload: domainPayload,
  type: "domain.created",
});

/**
 * `paused_reason` says who lifts a pause: `project_sending_pause` is lifted by Relayit when
 * SES restores the Project's sending, the others only by a platform admin. `checks_stopped`
 * is true once Relayit has given up checking a Domain that stayed unverified, until its
 * holder refreshes it.
 */
export const domainUpdated = defineWebhookEvent({
  payload: Schema.Struct({
    ...domainPayload.fields,
    checks_stopped: Schema.Boolean,
    paused: Schema.Boolean,
    paused_reason: Schema.NullOr(
      Schema.Literals(["bad_reputation", "manual_admin_pause", "project_sending_pause"]),
    ),
  }),
  type: "domain.updated",
});

export type DomainWebhookEvent =
  | WebhookEventInput<typeof domainCreated>
  | WebhookEventInput<typeof domainUpdated>;
