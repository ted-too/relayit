import { RiArrowRightLine } from "@remixicon/react";
import { Button } from "@repo/ui/components/ui/coss/button";
import { cn } from "@repo/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import { LayoutGroup, motion } from "motion/react";
import { useState } from "react";
import { selfHostSnippet } from "@/lib/snippets";
import { CodeHtml } from "./code-html";

type Mode = "cloud" | "self";
type Owner = "relayit" | "you";

const PARTS: readonly {
  cloud: Owner;
  id: string;
  label: string;
  self: Owner;
}[] = [
  { cloud: "relayit", id: "api", label: "API and job worker", self: "you" },
  { cloud: "relayit", id: "dashboard", label: "Dashboard", self: "you" },
  { cloud: "relayit", id: "postgres", label: "Postgres", self: "you" },
  { cloud: "relayit", id: "redis", label: "Redis", self: "you" },
  { cloud: "relayit", id: "storage", label: "Object storage", self: "you" },
  { cloud: "relayit", id: "provider", label: "Sending provider", self: "you" },
  {
    cloud: "relayit",
    id: "limits",
    label: "Plans and send limits",
    self: "relayit",
  },
  { cloud: "you", id: "dns", label: "Your domain's DNS", self: "you" },
  {
    cloud: "relayit",
    id: "releases",
    label: "Releases and images",
    self: "relayit",
  },
];

const SPRING = { damping: 28, stiffness: 260, type: "spring" } as const;

/** Self-hosted has no Plans: "limits" leaves the board instead of moving. */
const visible = (mode: Mode, id: string) =>
  !(mode === "self" && id === "limits");

function Column({
  mode,
  owner,
  title,
}: {
  mode: Mode;
  owner: Owner;
  title: string;
}) {
  const parts = PARTS.filter(
    (part) => part[mode] === owner && visible(mode, part.id)
  );
  return (
    <div
      className={cn(
        "flex min-h-[19rem] flex-col rounded-xl border p-6 md:p-8",
        owner === "relayit"
          ? "border-brand-ink bg-brand-ink text-brand-mint dark:border-brand-mint/15"
          : "bg-card"
      )}
    >
      <p
        className={cn(
          "font-medium text-lg",
          owner === "relayit" && "text-white"
        )}
      >
        {title}
      </p>
      <ul className="mt-6 flex flex-wrap content-start gap-2">
        {parts.map((part) => (
          <motion.li
            className={cn(
              "rounded-lg border px-3 py-2 text-sm",
              owner === "relayit"
                ? "border-white/15 bg-white/5 text-brand-mint"
                : "bg-background text-foreground"
            )}
            key={part.id}
            layoutId={part.id}
            transition={SPRING}
          >
            {part.label}
          </motion.li>
        ))}
      </ul>
    </div>
  );
}

interface OwnershipProps {
  readonly appUrl: string;
  readonly code: Record<string, string>;
  readonly signedIn: boolean;
}

export function Ownership({ appUrl, code, signedIn }: OwnershipProps) {
  const [mode, setMode] = useState<Mode>("cloud");

  return (
    <section className="border-t bg-muted/40">
      <div className="mx-auto max-w-[1400px] px-4 py-24 md:px-8 md:py-32">
        <div className="flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <h2 className="max-w-[16ch] font-semibold text-4xl tracking-[-0.03em] md:text-5xl">
            Same API. Pick who runs it.
          </h2>
          <div className="relative flex w-fit rounded-lg border bg-background p-1">
            {(
              [
                ["cloud", "Relayit Cloud"],
                ["self", "Self-hosted"],
              ] as const
            ).map(([value, label]) => (
              <button
                aria-pressed={mode === value}
                className={cn(
                  "relative cursor-pointer rounded-md px-4 py-2 font-medium text-sm transition-colors",
                  mode === value
                    ? "text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
                key={value}
                onClick={() => setMode(value)}
                type="button"
              >
                {mode === value && (
                  <motion.span
                    className="absolute inset-0 rounded-md bg-primary"
                    layoutId="ownership-pill"
                    transition={SPRING}
                  />
                )}
                <span className="relative">{label}</span>
              </button>
            ))}
          </div>
        </div>

        <LayoutGroup>
          <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
            <Column mode={mode} owner="relayit" title="Relayit runs" />
            <Column mode={mode} owner="you" title="You run" />
          </div>
        </LayoutGroup>

        <div className="mt-8 grid min-h-[8.5rem] grid-cols-1 items-center gap-6 md:grid-cols-[minmax(0,1fr)_auto]">
          {mode === "cloud" ? (
            <>
              <p className="max-w-[60ch] text-muted-foreground leading-relaxed">
                Sign up, verify a domain and send. We operate the queue, the
                workers and the providers behind them.
              </p>
              <Button
                className="w-fit active:scale-[0.98]"
                render={
                  <a href={signedIn ? appUrl : `${appUrl}/auth/sign-up`} />
                }
                size="lg"
              >
                {signedIn ? "Open dashboard" : "Start sending"}
                <RiArrowRightLine />
              </Button>
            </>
          ) : (
            <>
              <div className="overflow-hidden rounded-xl border bg-background">
                <CodeHtml html={code[selfHostSnippet.id]} />
              </div>
              <Button
                className="w-fit active:scale-[0.98]"
                render={
                  <Link params={{ _splat: "self-hosting" }} to="/docs/$" />
                }
                size="lg"
                variant="outline"
              >
                Self-hosting guide
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
