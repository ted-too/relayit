/**
 * Marketing copy of the Cloud plans. Limits mirror
 * packages/persistence/src/auth/plans.ts; prices mirror the Stripe prices the
 * dashboard bills against (STRIPE_PRICE_*). Update both together.
 */
export interface Plan {
  readonly annual: number;
  readonly id: "free" | "signal" | "broadcast";
  readonly limits: readonly string[];
  readonly monthly: number;
  readonly monthlySends: number;
  readonly name: string;
  readonly pitch: string;
}

export const plans: readonly Plan[] = [
  {
    annual: 0,
    id: "free",
    limits: [
      "2,500 emails a month, 80 a day",
      "1 project, 1 custom domain",
      "7 days of message history",
    ],
    monthly: 0,
    monthlySends: 2500,
    name: "Free",
    pitch: "For side projects and trying the API.",
  },
  {
    annual: 150,
    id: "signal",
    limits: [
      "40,000 emails a month",
      "3 projects, unlimited domains",
      "30 days of message history",
    ],
    monthly: 15,
    monthlySends: 40_000,
    name: "Signal",
    pitch: "For products with real users.",
  },
  {
    annual: 990,
    id: "broadcast",
    limits: [
      "200,000 emails a month",
      "Up to 1,000,000 through your own AWS",
      "5 projects, 90 days of history",
    ],
    monthly: 99,
    monthlySends: 200_000,
    name: "Broadcast",
    pitch: "For high volume and your own provider.",
  },
];

/** Broadcast with a bring-your-own provider. */
export const BYO_CEILING = 1_000_000;
