import { defineJob, type JobPayload } from "@repo/jobs";
import { Schema } from "effect";

/**
 * Deletes the SES identity of a Domain that was removed. The payload names the identity
 * itself, since the Domain's row is gone by the time this runs, and the DKIM selector the
 * Domain signed with: the identity is deleted only if it signs with that one, which is what
 * makes it the removed Domain's and not one Relayit never made or a Domain added since.
 */
export const emailDeleteDomainIdentityJob = defineJob({
  dispatch: "transactional",
  name: "email.delete-domain-identity",
  payload: Schema.Struct({
    dkimSelector: Schema.String,
    fqdn: Schema.String,
    /** The registration's region; null is the default region, as on the registration. */
    region: Schema.NullOr(Schema.String),
  }),
  // Nothing drives this again once it is a dead letter, so it outlasts an SES outage of
  // about an hour before giving up.
  retry: {
    backoff: {
      baseDelayMs: 30_000,
      maxDelayMs: 15 * 60_000,
    },
    maxAttempts: 10,
  },
});

export type EmailDeleteDomainIdentityPayload = JobPayload<typeof emailDeleteDomainIdentityJob>;
