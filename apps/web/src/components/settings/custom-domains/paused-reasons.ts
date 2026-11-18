import type { Domain } from "./types";

/**
 * Why a Domain is paused. `label` is the short name of the reason; `description` is what a
 * Project's members read, who can see a pause and not lift it. `liftedBy` is who ends it.
 *
 * `project_sending_pause` is the pause Relayit makes itself when SES pauses the Project's
 * sending, and lifts itself when SES restores it. It is the Project's reputation, not the
 * Domain's: every Domain the Project holds in the region is paused, whichever the bounces
 * came from. `bad_reputation` is an admin's choice of reason, and also what Relayit's own
 * pauses were recorded as before they had a reason of their own, so it still cannot say
 * which; either way only an admin lifts it.
 */
export const PAUSED_REASONS = {
  bad_reputation: {
    description:
      "It was paused for the Project's sending reputation (too many bounces or complaints), automatically or by Relayit's operators.",
    label: "Bad reputation",
    liftedBy: "operators",
  },
  manual_admin_pause: {
    description: "Relayit's operators paused it.",
    label: "Operator pause",
    liftedBy: "operators",
  },
  project_sending_pause: {
    description:
      "It was paused automatically because sending is paused for the whole Project, for its sending reputation (too many bounces or complaints).",
    label: "Project sending paused",
    liftedBy: "relayit",
  },
} as const satisfies Record<
  NonNullable<Domain["pausedReason"]>,
  { description: string; label: string; liftedBy: "operators" | "relayit" }
>;
