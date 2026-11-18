import type { Domain } from "./types";

/**
 * Why a Domain is paused. `label` is the short name of the reason; `description` is what a
 * Project's members read, who can see a pause and not lift it: only Relayit's operators
 * pause and unpause.
 */
export const PAUSED_REASONS = {
  bad_reputation: {
    description:
      "Relayit's operators paused it for its sending reputation: too many bounces or complaints.",
    label: "Bad reputation",
  },
  manual_admin_pause: {
    description: "Relayit's operators paused it.",
    label: "Operator pause",
  },
} as const satisfies Record<
  NonNullable<Domain["pausedReason"]>,
  { description: string; label: string }
>;
