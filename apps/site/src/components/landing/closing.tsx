import { RiArrowRightLine } from "@remixicon/react";
import { Button } from "@repo/ui/components/ui/coss/button";
import { Link } from "@tanstack/react-router";

interface ClosingProps {
  readonly appUrl: string;
  readonly signedIn: boolean;
}

/** The product name as the last instruction on the page. */
export function Closing({ appUrl, signedIn }: ClosingProps) {
  return (
    <section className="overflow-hidden border-t">
      <div className="mx-auto max-w-[1400px] px-4 pt-20 pb-16 md:px-8 md:pt-28">
        <p className="reveal select-none font-semibold text-[25vw] text-primary leading-[0.8] tracking-[-0.07em] md:text-[19rem] dark:text-brand-mint">
          Relay it.
        </p>
        <div className="mt-12 flex flex-col gap-8 md:flex-row md:items-end md:justify-between">
          <p className="max-w-[40ch] text-lg text-muted-foreground leading-relaxed">
            Create a project, grab an API key and send a test email from the
            sandbox domain in a few minutes.
          </p>
          <div className="flex flex-wrap gap-3">
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
      </div>
    </section>
  );
}
