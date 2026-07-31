import { env } from "@repo/api/env";
import Stripe from "stripe";

let stripeClientInstance: Stripe | undefined;

/**
 * Shared Stripe client (cloud edition). Lazy so OSS/self-host never constructs
 * a client or requires `STRIPE_SECRET_KEY`. Lives in its own leaf module so both
 * the better-auth config and the provisioning helper can share one instance
 * without forming an auth ⇄ provisioning import cycle.
 */
export function getStripeClient(): Stripe {
  if (!env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY is required when using Stripe");
  }

  if (!stripeClientInstance) {
    stripeClientInstance = new Stripe(env.STRIPE_SECRET_KEY, {
      apiVersion: "2026-05-27.dahlia",
    });
  }

  return stripeClientInstance;
}
