import { createFileRoute, getRouteApi } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import { Closing } from "@/components/landing/closing";
import { Hero } from "@/components/landing/hero";
import { Migrate } from "@/components/landing/migrate";
import { Ownership } from "@/components/landing/ownership";
import { Pricing } from "@/components/landing/pricing";
import { Route as Journey } from "@/components/landing/route";
import { getLandingCode } from "@/lib/content.functions";

const root = getRouteApi("__root__");

export const Route = createFileRoute("/")({
  loader: () => getLandingCode(),
  staleTime: Number.POSITIVE_INFINITY,
  component: Landing,
});

function Landing() {
  const code = Route.useLoaderData();
  const { appUrl, viewer } = root.useLoaderData();
  const signedIn = viewer !== null;

  return (
    <MotionConfig reducedMotion="user">
      <Hero appUrl={appUrl} code={code} signedIn={signedIn} />
      <Journey />
      <Migrate />
      <Ownership appUrl={appUrl} code={code} signedIn={signedIn} />
      <Pricing appUrl={appUrl} signedIn={signedIn} />
      <Closing appUrl={appUrl} signedIn={signedIn} />
    </MotionConfig>
  );
}
