import type { Domain } from "./types";

/**
 * Why a Domain is paused. `label` is the short name of the reason; `description` is what a
 * Project's members read, who can see a pause and not lift it. `bad_reputation` names no
 * one: the worker sets it itself when SES pauses the Project's sending, and an admin can
 * choose it too, and the Domain doesn't record which.
 */
export const PAUSED_REASONS = {
  bad_reputation: {
    description:
      "It was paused for its sending reputation (too many bounces or complaints), automatically or by Relayit's operators.",
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
