import { RiArrowRightLine, RiCheckLine } from "@remixicon/react";
import { Button } from "@repo/ui/components/ui/coss/button";
import { cn } from "@repo/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { AnimatePresence, motion } from "motion/react";
import { useId, useState } from "react";
import { BYO_CEILING, type Plan, plans } from "@/lib/plans";

const VOLUMES = [
  1000, 2500, 10_000, 25_000, 40_000, 100_000, 200_000, 500_000, 1_000_000,
  2_000_000,
] as const;
const DEFAULT_INDEX = 4;

const number = new Intl.NumberFormat("en-US");

const pickPlan = (volume: number) =>
  plans.find((plan) => volume <= plan.monthlySends) ?? null;

/** Swaps a value with a short vertical roll so the change reads as a change. */
function Roll({ children, id }: { children: React.ReactNode; id: string }) {
  return (
    <span className="relative inline-flex overflow-hidden align-bottom">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          animate={{ opacity: 1, y: 0 }}
          className="inline-block"
          exit={{ opacity: 0, y: "-60%" }}
          initial={{ opacity: 0, y: "60%" }}
          key={id}
          transition={{ damping: 26, stiffness: 300, type: "spring" }}
        >
          {children}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

const price = (plan: Plan, annual: boolean) =>
  plan.monthly === 0 ? "$0" : `$${annual ? plan.annual : plan.monthly}`;

interface PricingProps {
  readonly appUrl: string;
  readonly signedIn: boolean;
}

export function Pricing({ appUrl, signedIn }: PricingProps) {
  const sliderId = useId();
  const [index, setIndex] = useState(DEFAULT_INDEX);
  const [annual, setAnnual] = useState(false);
  const volume = VOLUMES[index] ?? VOLUMES[DEFAULT_INDEX];
  const plan = pickPlan(volume);
  const byo = !plan && volume <= BYO_CEILING;
  const cadence = annual ? "year" : "month";
  const signUp = signedIn ? appUrl : `${appUrl}/auth/sign-up`;

  let verdict: React.ReactNode;
  if (plan) {
    verdict = (
      <>
        <Roll id={plan.id}>
          <span className="text-primary dark:text-brand-mint">{plan.name}</span>
        </Roll>{" "}
        covers it for{" "}
        <Roll id={`${plan.id}-${cadence}`}>
          <span className="text-primary dark:text-brand-mint">
            {price(plan, annual)}
          </span>
        </Roll>{" "}
        a {cadence}.
      </>
    );
  } else if (byo) {
    verdict = (
      <>
        <Roll id="byo">
          <span className="text-primary dark:text-brand-mint">Broadcast</span>
        </Roll>{" "}
        with your own AWS covers it.
      </>
    );
  } else {
    verdict = (
      <>
        <Roll id="self">
          <span className="text-primary dark:text-brand-mint">Self-host</span>
        </Roll>{" "}
        and send without limits.
      </>
    );
  }

  return (
    <section className="scroll-mt-16 border-t" id="plans">
      <div className="mx-auto max-w-[1400px] px-4 py-24 md:px-8 md:py-32">
        <p
          aria-live="polite"
          className="max-w-[30ch] font-semibold text-4xl leading-[1.08] tracking-[-0.03em] md:text-6xl"
        >
          At{" "}
          <Roll id={String(volume)}>
            <span className="tabular-nums">{number.format(volume)}</span>
          </Roll>{" "}
          emails a month, {verdict}
        </p>

        <div className="mt-12 grid max-w-3xl gap-3">
          <label className="text-muted-foreground text-sm" htmlFor={sliderId}>
            Emails you send each month
          </label>
          <input
            aria-valuetext={`${number.format(volume)} emails a month`}
            className="volume-slider w-full"
            id={sliderId}
            max={VOLUMES.length - 1}
            min={0}
            onChange={(event) => setIndex(Number(event.target.value))}
            step={1}
            type="range"
            value={index}
          />
          <div className="flex justify-between font-mono text-muted-foreground text-xs">
            <span>1k</span>
            <span>2M</span>
          </div>
        </div>

        <div className="mt-16 flex items-center justify-between gap-4">
          <p className="text-muted-foreground text-sm">
            Prices in USD. Annual billing gets two months free.
          </p>
          <div className="flex rounded-lg border bg-background p-1">
            {([false, true] as const).map((value) => (
              <button
                aria-pressed={annual === value}
                className={cn(
                  "relative cursor-pointer rounded-md px-3 py-1.5 text-sm transition-colors",
                  annual === value
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                key={String(value)}
                onClick={() => setAnnual(value)}
                type="button"
              >
                {annual === value && (
                  <motion.span
                    className="absolute inset-0 rounded-md bg-accent"
                    layoutId="billing-pill"
                  />
                )}
                <span className="relative">{value ? "Annual" : "Monthly"}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="mt-5 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {plans.map((item) => {
            const chosen =
              item.id === plan?.id || (byo && item.id === "broadcast");
            return (
              <div
                className={cn(
                  "flex flex-col rounded-xl border p-7 transition-colors duration-500",
                  chosen
                    ? "border-brand-ink bg-brand-ink text-brand-mint dark:border-brand-mint/20"
                    : "bg-card"
                )}
                key={item.id}
              >
                <div className="flex items-baseline justify-between gap-4">
                  <p
                    className={cn(
                      "font-medium text-lg",
                      chosen && "text-white"
                    )}
                  >
                    {item.name}
                  </p>
                  {chosen && (
                    <span className="text-brand-mint/70 text-xs">
                      Fits your volume
                    </span>
                  )}
                </div>
                <p
                  className={cn(
                    "mt-1 text-sm",
                    chosen ? "text-brand-mint/70" : "text-muted-foreground"
                  )}
                >
                  {item.pitch}
                </p>
                <p className="mt-8 flex items-baseline gap-1.5">
                  <span
                    className={cn(
                      "font-semibold text-5xl tabular-nums tracking-[-0.04em]",
                      chosen && "text-white"
                    )}
                  >
                    {price(item, annual)}
                  </span>
                  <span
                    className={cn(
                      "text-sm",
                      chosen ? "text-brand-mint/70" : "text-muted-foreground"
                    )}
                  >
                    / {item.monthly === 0 ? "forever" : cadence}
                  </span>
                </p>
                <ul className="mt-8 grid gap-2.5 text-sm">
                  {item.limits.map((limit) => (
                    <li className="flex gap-2" key={limit}>
                      <RiCheckLine
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          chosen
                            ? "text-brand-mint"
                            : "text-primary dark:text-brand-mint"
                        )}
                      />
                      {limit}
                    </li>
                  ))}
                </ul>
                <Button
                  className={cn(
                    "mt-10 w-full active:scale-[0.98]",
                    chosen &&
                      "border-brand-mint bg-brand-mint text-brand-ink shadow-none hover:bg-brand-mint/90"
                  )}
                  render={<a href={signUp} />}
                  variant={chosen ? "default" : "outline"}
                >
                  {signedIn ? "Open dashboard" : "Start sending"}
                </Button>
              </div>
            );
          })}
        </div>

        <div
          className={cn(
            "mt-4 flex flex-col gap-4 rounded-xl border p-7 transition-colors duration-500 md:flex-row md:items-center md:justify-between",
            plan || byo
              ? "bg-card"
              : "border-brand-ink bg-brand-ink text-brand-mint dark:border-brand-mint/20"
          )}
        >
          <div>
            <p
              className={cn(
                "font-medium text-lg",
                !(plan || byo) && "text-white"
              )}
            >
              Self-hosted{" "}
              <span className="font-normal opacity-70">$0, no send limits</span>
            </p>
            <p
              className={cn(
                "mt-1 text-sm",
                plan || byo ? "text-muted-foreground" : "text-brand-mint/70"
              )}
            >
              Run the same API on your own servers. Every feature, no plans.
            </p>
          </div>
          <Link
            className="group inline-flex items-center gap-1.5 font-medium text-sm"
            params={{ _splat: "self-hosting" }}
            to="/docs/$"
          >
            Self-hosting guide
            <RiArrowRightLine className="size-4 transition-transform group-hover:translate-x-0.5" />
          </Link>
        </div>
      </div>
    </section>
  );
}
