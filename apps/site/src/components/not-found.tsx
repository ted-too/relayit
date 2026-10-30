import { Button } from "@repo/ui/components/ui/coss/button";
import { Link } from "@tanstack/react-router";

export function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-1 flex-col items-start justify-center gap-5 px-4 py-24 md:px-8">
      <p className="font-mono text-muted-foreground text-sm">404</p>
      <h1 className="font-semibold text-4xl tracking-tight">
        This page did not arrive.
      </h1>
      <p className="max-w-[50ch] text-muted-foreground">
        The link may be out of date, or the page moved when the docs were
        rewritten.
      </p>
      <div className="flex gap-3">
        <Button render={<Link to="/" />}>Back home</Button>
        <Button
          render={<Link params={{ _splat: "" }} to="/docs/$" />}
          variant="outline"
        >
          Read the docs
        </Button>
      </div>
    </div>
  );
}
