import { defineJob, type JobPayload } from "@repo/jobs";
import { Schema } from "effect";

export const emailDeliverJob = defineJob({
  dispatch: "transactional",
  name: "email.deliver",
  payload: Schema.Struct({
    billingUserId: Schema.String,
    deliveryId: Schema.String,
    providerKind: Schema.Literals(["managed", "byo"]),
    purpose: Schema.Literals(["transactional", "marketing"]),
    startDate: Schema.String,
    /** Campaign Topic id — required for List-Unsubscribe on marketing sends. */
    topicId: Schema.optionalKey(Schema.String),
  }),
  retry: {
    backoff: {
      baseDelayMs: 30_000,
      maxDelayMs: 15 * 60_000,
    },
    maxAttempts: 5,
  },
});

export type EmailDeliverPayload = JobPayload<typeof emailDeliverJob>;
