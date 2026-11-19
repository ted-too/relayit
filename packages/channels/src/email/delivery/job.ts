import { defineJob, type JobPayload } from "@repo/jobs";
import { Schema } from "effect";

export const emailDeliverJob = defineJob({
  dispatch: "transactional",
  name: "email.deliver",
  payload: Schema.Struct({
    billingUserId: Schema.String,
    deliveryId: Schema.String,
    /**
     * Not read: the handler takes the purpose, and the Topic, from the Message. Still sent
     * because the release before this one requires it of a job it runs during a rollout.
     */
    purpose: Schema.Literals(["transactional", "marketing"]),
    startDate: Schema.String,
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
