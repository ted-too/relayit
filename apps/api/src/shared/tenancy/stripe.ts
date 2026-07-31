import { env } from "@repo/api/env";
import Stripe from "stripe";

/**
 * Shared Stripe client. Lives in its own leaf module so both the better-auth
 * config and the provisioning helper can use the same instance without forming
 * an auth ⇄ provisioning import cycle.
 */
export const stripeClient = new Stripe(env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-05-27.dahlia",
});
