import { Button } from "@repo/old-ui/components/shadcn/button";
import { Skeleton } from "@repo/old-ui/components/shadcn/skeleton";
import { formatCompactNumber } from "@repo/old-ui/lib/utils";
import Link from "next/link";
import * as React from "react";
import { Icons } from "@/components/icons";
import { siteConfig } from "@/lib/config";

export function GitHubLink() {
  return (
    <Button asChild className="h-8 w-max shadow-none" size="sm" variant="ghost">
      <Link href={siteConfig.links.github} rel="noreferrer" target="_blank">
        <Icons.gitHub />
        <React.Suspense fallback={<Skeleton className="h-4 w-8" />}>
          <StarsCount />
        </React.Suspense>
      </Link>
    </Button>
  );
}

export async function StarsCount() {
  const data = await fetch(siteConfig.links.githubApi, {
    next: { revalidate: 86_400 }, // Cache for 1 day (86400 seconds)
  });
  const json = await data.json();

  const stars = json?.stargazers_count ?? 0;

  if (stars < 5) {
    return null;
  }

  return (
    <span className="text-muted-foreground text-xs tabular-nums">
      {formatCompactNumber(stars)}
    </span>
  );
}
