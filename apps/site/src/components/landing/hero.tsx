import {
  RiArrowRightLine,
  RiArrowRightSLine,
  RiCheckLine,
} from "@remixicon/react";
import { Button } from "@repo/ui/components/ui/coss/button";
import { Link } from "@tanstack/react-router";
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { heroRequest } from "@/lib/snippets";
import { CodeHtml } from "./code-html";
import { RenderedEmail } from "./rendered-email";

interface HeroProps {
  readonly appUrl: string;
  readonly code: Record<string, string>;
  readonly signedIn: boolean;
}

const SPRING = { damping: 20, stiffness: 120 };

/** Request in, email out: the two ends of the relay, tilting with the pointer. */
function Baton({ code }: { code: Record<string, string> }) {
  const reduce = useReducedMotion();
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const rotateY = useSpring(useTransform(px, [-0.5, 0.5], [-7, 7]), SPRING);
  const rotateX = useSpring(useTransform(py, [-0.5, 0.5], [6, -6]), SPRING);
  const lift = useSpring(useTransform(px, [-0.5, 0.5], [-10, 10]), SPRING);

  return (
    <motion.div
      className="relative mx-auto aspect-[5/4.4] w-full max-w-[600px] [perspective:1400px]"
      onPointerLeave={() => {
        px.set(0);
        py.set(0);
      }}
      onPointerMove={(event) => {
        if (reduce) {
          return;
        }
        const box = event.currentTarget.getBoundingClientRect();
        px.set((event.clientX - box.left) / box.width - 0.5);
        py.set((event.clientY - box.top) / box.height - 0.5);
      }}
    >
      <motion.div
        className="absolute inset-0 [transform-style:preserve-3d]"
        style={reduce ? undefined : { rotateX, rotateY }}
      >
        {/* The request: what you hand over. */}
        <div className="rise absolute top-0 left-0 w-[78%] -rotate-[4deg] overflow-hidden rounded-xl border bg-card shadow-[0_24px_60px_-34px] shadow-brand-ink/40 [--rise-delay:120ms] dark:shadow-black">
          <CodeHtml className="text-[11.5px]" html={code[heroRequest.id]} />
        </div>
        {/* The email: what arrives. */}
        <motion.div
          className="rise absolute right-0 bottom-[6%] w-[66%] rotate-[3deg] [--rise-delay:320ms]"
          style={reduce ? undefined : { x: lift }}
        >
          <RenderedEmail />
        </motion.div>
        {/* The receipt in between. */}
        <div className="rise absolute bottom-[1%] left-[4%] flex items-center gap-2 rounded-lg border bg-background px-3 py-2 font-mono text-[11.5px] shadow-brand-ink/10 shadow-lg [--rise-delay:520ms]">
          <span className="flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground dark:bg-brand-mint dark:text-brand-ink">
            <RiCheckLine className="size-3" />
          </span>
          <span>sent</span>
          <span className="text-muted-foreground">msg_01jbxk7d4q…</span>
        </div>
      </motion.div>
    </motion.div>
  );
}

export function Hero({ appUrl, code, signedIn }: HeroProps) {
  return (
    <section className="relative overflow-hidden">
      <div className="mx-auto grid max-w-[1400px] grid-cols-1 items-center gap-14 px-4 pt-12 pb-20 md:px-8 lg:min-h-[calc(100dvh-4rem)] lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:gap-10 lg:pt-6 lg:pb-16">
        <div className="flex flex-col items-start">
          <a
            className="rise group mb-8 inline-flex items-center gap-1.5 rounded-full border bg-background py-1 pr-2 pl-3 text-muted-foreground text-xs transition-colors hover:text-foreground"
            href="#migrate"
          >
            Resend-compatible API
            <RiArrowRightSLine className="size-3.5 transition-transform group-hover:translate-x-0.5" />
          </a>
          <h1 className="rise font-semibold text-[3.4rem] leading-[0.95] tracking-[-0.045em] [--rise-delay:60ms] sm:text-7xl lg:text-[6.4rem]">
            You write it.
            <span className="block text-primary dark:text-brand-mint">
              We relay it.
            </span>
          </h1>
          <p className="rise mt-8 max-w-[44ch] text-lg text-muted-foreground leading-relaxed [--rise-delay:140ms]">
            One API call and Relayit renders, signs, queues, delivers and tracks
            your product's email. On our cloud or your servers.
          </p>
          <div className="rise mt-10 flex flex-wrap gap-3 [--rise-delay:220ms]">
            <Button
              className="active:scale-[0.98]"
              render={<a href={signedIn ? appUrl : `${appUrl}/auth/sign-up`} />}
              size="xl"
            >
              {signedIn ? "Open dashboard" : "Start sending"}
              <RiArrowRightLine />
            </Button>
            <Button
              className="active:scale-[0.98]"
              render={<Link params={{ _splat: "quickstart" }} to="/docs/$" />}
              size="xl"
              variant="outline"
            >
              Read the docs
            </Button>
          </div>
        </div>
        <Baton code={code} />
      </div>
    </section>
  );
}
