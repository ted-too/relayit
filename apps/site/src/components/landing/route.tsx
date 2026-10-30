import { RiArrowRightLine, RiCheckLine } from "@remixicon/react";
import { cn } from "@repo/ui/lib/utils";
import { Link } from "@tanstack/react-router";
import {
  motion,
  useMotionValueEvent,
  useScroll,
  useTransform,
} from "motion/react";
import { useRef, useState } from "react";
import { RenderedEmail } from "./rendered-email";

const MESSAGE_ID = "msg_01jbxk7d4qf3t9s2vw8cyh6m5n";

function Mono({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("font-mono text-[12.5px]", className)}>{children}</span>
  );
}

function Status({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone: "ok" | "bad" | "muted";
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 font-mono text-[11.5px]",
        tone === "ok" && "border-success/40 text-success-foreground",
        tone === "bad" && "border-destructive/40 text-destructive-foreground",
        tone === "muted" && "text-muted-foreground"
      )}
    >
      {tone === "ok" && <RiCheckLine className="size-3" />}
      {children}
    </span>
  );
}

const panel = "w-full overflow-hidden rounded-xl border bg-card";

function AcceptArtifact() {
  return (
    <div className="grid w-full gap-3">
      <div className={panel}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-4 py-2.5">
          <Mono>POST /messages/email</Mono>
          <Mono className="text-muted-foreground">
            idempotency-key: order-4821-shipped
          </Mono>
        </div>
        <div className="flex items-center gap-3 px-4 py-4">
          <span className="rounded bg-primary px-1.5 py-0.5 font-mono text-[12px] text-primary-foreground">
            201
          </span>
          <Mono className="truncate">{`{ "id": "${MESSAGE_ID}" }`}</Mono>
        </div>
      </div>
      <div className={cn(panel, "bg-muted/50")}>
        <div className="px-4 py-3 text-muted-foreground text-sm">
          Retry with the same key and you get the same id back. No second email.
        </div>
        <div className="flex items-center gap-3 border-t px-4 py-3.5">
          <span className="rounded bg-primary px-1.5 py-0.5 font-mono text-[12px] text-primary-foreground">
            201
          </span>
          <Mono className="truncate">{`{ "id": "${MESSAGE_ID}" }`}</Mono>
        </div>
      </div>
    </div>
  );
}

function RenderArtifact() {
  return (
    <div className="grid w-full items-center gap-4 lg:grid-cols-[minmax(0,0.8fr)_auto_minmax(0,1.2fr)]">
      <div className={cn(panel, "px-4 py-4")}>
        <Mono className="block text-muted-foreground">order-shipped</Mono>
        <Mono className="mt-2 block">{'{ "orderId": "4821" }'}</Mono>
      </div>
      <RiArrowRightLine className="mx-auto size-5 rotate-90 text-muted-foreground lg:rotate-0" />
      <RenderedEmail highlightVariable />
    </div>
  );
}

const RECORDS = [
  { host: "relayit3f9a1c2e._domainkey", purpose: "DKIM", type: "TXT" },
  { host: "_dmarc", purpose: "DMARC", type: "TXT" },
  { host: "send", purpose: "Return path", type: "MX" },
  { host: "send", purpose: "SPF", type: "TXT" },
] as const;

function SignArtifact() {
  return (
    <div className={panel}>
      <div className="flex items-center justify-between border-b px-4 py-2.5">
        <span className="font-medium text-sm">fernwood.shop</span>
        <Status tone="ok">Verified</Status>
      </div>
      {RECORDS.map((record) => (
        <div
          className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2.5"
          key={`${record.type}-${record.purpose}`}
        >
          <Mono className="text-muted-foreground">{record.type}</Mono>
          <Mono className="truncate">{record.host}</Mono>
          <Status tone="ok">{record.purpose}</Status>
        </div>
      ))}
    </div>
  );
}

function DeliverArtifact() {
  const steps = [
    {
      note: '"scheduled_at": "2026-11-02T09:00:00Z"',
      status: "queued",
      tone: "muted",
    },
    { note: "Provider timed out. Retrying.", status: "sending", tone: "muted" },
    {
      note: "Retried and accepted by the provider.",
      status: "sending",
      tone: "muted",
    },
    { note: "maya.okafor@example.com", status: "sent", tone: "ok" },
  ] as const;
  return (
    <ol className={cn(panel, "relative px-5 py-5")}>
      {steps.map((step, index) => (
        <li
          className="relative grid grid-cols-[5.5rem_minmax(0,1fr)] items-start gap-3 pb-5 last:pb-0"
          key={step.note}
        >
          {index < steps.length - 1 && (
            <span
              aria-hidden
              className="absolute top-6 bottom-0 left-[1.4rem] w-px bg-border"
            />
          )}
          <span className="relative w-fit bg-card">
            <Status tone={step.tone}>{step.status}</Status>
          </span>
          <span className="pt-0.5 text-muted-foreground text-sm">
            {step.note}
          </span>
        </li>
      ))}
    </ol>
  );
}

function ProtectArtifact() {
  return (
    <div className="grid w-full gap-3">
      <div
        className={cn(panel, "flex flex-wrap items-center gap-3 px-4 py-3.5")}
      >
        <Status tone="bad">failed</Status>
        <Mono className="text-muted-foreground">hard bounce</Mono>
        <Mono className="ml-auto">jo@closed-mailbox.net</Mono>
      </div>
      <div
        className={cn(
          panel,
          "flex flex-wrap items-center gap-3 border-primary/30 bg-primary/5 px-4 py-3.5 dark:border-brand-mint/30 dark:bg-brand-mint/5"
        )}
      >
        <span className="font-medium text-sm">Suppressed</span>
        <Mono className="text-muted-foreground">severity: all</Mono>
        <Mono className="ml-auto">jo@closed-mailbox.net</Mono>
      </div>
      <div
        className={cn(panel, "flex flex-wrap items-center gap-3 px-4 py-3.5")}
      >
        <Status tone="muted">skipped</Status>
        <Mono className="text-muted-foreground">
          next send, never attempted
        </Mono>
        <Mono className="ml-auto">jo@closed-mailbox.net</Mono>
      </div>
    </div>
  );
}

const STOPS = [
  {
    artifact: <AcceptArtifact />,
    body: "Your request is validated and answered with a message id. An idempotency key makes retries safe.",
    verb: "Accept",
  },
  {
    artifact: <RenderArtifact />,
    body: "Name a published React Email template. Its variables are filled in at send time.",
    verb: "Render",
  },
  {
    artifact: <SignArtifact />,
    body: "Mail leaves from your verified domain, signed with a DKIM key generated just for it.",
    verb: "Sign",
  },
  {
    artifact: <DeliverArtifact />,
    body: "Work waits for scheduled_at if you set one, and failed attempts are retried.",
    verb: "Deliver",
  },
  {
    artifact: <ProtectArtifact />,
    body: "Hard bounces and complaints suppress the address, so the next send to it is skipped.",
    verb: "Protect",
  },
] as const;

const HOLD = 0.085;

/** Scroll keyframes: stop i is held around i/(n-1), with travel in between. */
const holdFrames = (count: number) => {
  const input: number[] = [];
  const stops: number[] = [];
  for (let index = 0; index < count; index++) {
    const center = index / (count - 1);
    input.push(Math.max(0, center - HOLD), Math.min(1, center + HOLD));
    stops.push(index, index);
  }
  return { input, stops };
};

export function Route() {
  const section = useRef<HTMLElement>(null);
  const { scrollYProgress } = useScroll({
    offset: ["start start", "end end"],
    target: section,
  });
  const lastStop = STOPS.length - 1;
  // Each stop holds still for a stretch of scroll, then the track moves on.
  const { input, stops } = holdFrames(STOPS.length);
  const trackX = useTransform(
    scrollYProgress,
    input,
    stops.map((stop) => `-${(stop / STOPS.length) * 100}%`)
  );
  const fill = useTransform(
    scrollYProgress,
    input,
    stops.map((stop) => stop / lastStop)
  );
  const batonX = useTransform(
    scrollYProgress,
    input,
    stops.map((stop) => `${(stop / lastStop) * 100 - 100}%`)
  );
  const [active, setActive] = useState(0);
  useMotionValueEvent(scrollYProgress, "change", (value) => {
    setActive(Math.min(lastStop, Math.round(value * lastStop)));
  });

  return (
    <section
      aria-label="How a message moves through Relayit"
      className={"relative border-t md:motion-safe:h-[460vh]"}
      ref={section}
    >
      <div
        className={
          "md:motion-safe:sticky md:motion-safe:top-16 md:motion-safe:flex md:motion-safe:h-[calc(100dvh-4rem)] md:motion-safe:flex-col md:motion-safe:overflow-hidden"
        }
      >
        <div className="mx-auto w-full max-w-[1400px] px-4 pt-16 md:px-8 md:pt-12">
          <h2 className="max-w-[16ch] font-semibold text-4xl tracking-[-0.03em] md:text-5xl">
            One message, five stops.
          </h2>
          {/* The route line: the baton travels as you scroll. */}
          <div className={"relative mt-10 hidden md:motion-safe:block"}>
            <div className="relative h-px w-full bg-border">
              <motion.div
                className="absolute inset-0 origin-left bg-primary dark:bg-brand-mint"
                style={{ scaleX: fill }}
              />
              <motion.div className="absolute inset-0" style={{ x: batonX }}>
                <span className="absolute top-1/2 right-0 size-3 translate-x-1/2 -translate-y-1/2 rounded-full bg-primary ring-4 ring-background dark:bg-brand-mint" />
              </motion.div>
            </div>
            <ol className="relative mt-4 h-5">
              {STOPS.map((stop, index) => (
                <li
                  className={cn(
                    "absolute top-0 text-sm transition-colors duration-300",
                    index > 0 && index < lastStop && "-translate-x-1/2",
                    index === lastStop && "-translate-x-full",
                    active === index
                      ? "font-medium text-foreground"
                      : "text-muted-foreground"
                  )}
                  key={stop.verb}
                  style={{ left: `${(index / lastStop) * 100}%` }}
                >
                  {stop.verb}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <motion.div
          className={
            "max-md:transform-none! motion-reduce:transform-none! flex flex-col md:motion-safe:w-[500%] md:motion-safe:flex-1 md:motion-safe:flex-row"
          }
          style={{ x: trackX }}
        >
          {STOPS.map((stop) => (
            <article
              className={
                "mx-auto grid w-full max-w-[1400px] grid-cols-1 items-center gap-8 px-4 py-14 md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] md:gap-16 md:px-8 md:motion-safe:w-1/5 md:motion-safe:max-w-none md:motion-safe:shrink-0 md:motion-safe:px-[max(2rem,calc((100vw-1400px)/2+2rem))] md:motion-safe:py-0"
              }
              key={stop.verb}
            >
              <div>
                <h3 className="font-semibold text-6xl text-primary tracking-[-0.05em] md:text-[7.5rem] md:leading-[0.9] dark:text-brand-mint">
                  {stop.verb}
                </h3>
                <p className="mt-6 max-w-[34ch] text-lg text-muted-foreground leading-relaxed">
                  {stop.body}
                </p>
                {stop.verb === "Protect" && (
                  <Link
                    className="group mt-8 inline-flex items-center gap-1.5 font-medium text-sm"
                    params={{ _splat: "sending-email" }}
                    to="/docs/$"
                  >
                    Read the sending guide
                    <RiArrowRightLine className="size-4 transition-transform group-hover:translate-x-0.5" />
                  </Link>
                )}
              </div>
              <div className="flex min-w-0 justify-center">
                <div className="w-full max-w-[560px]">{stop.artifact}</div>
              </div>
            </article>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
