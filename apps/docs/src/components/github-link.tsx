import * as React from "react";
import Link from "next/link";

import { siteConfig } from "@/lib/config";
import { Icons } from "@/components/icons";
import { Button } from "@repo/ui/components/shadcn/button";
import { Skeleton } from "@repo/ui/components/shadcn/skeleton";
import { formatCompactNumber } from "@repo/ui/lib/utils";

export function GitHubLink() {
	return (
		<Button asChild size="sm" variant="ghost" className="h-8 shadow-none w-max">
			<Link href={siteConfig.links.github} target="_blank" rel="noreferrer">
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
		next: { revalidate: 86400 }, // Cache for 1 day (86400 seconds)
	});
	const json = await data.json();

	const stars = json?.stargazers_count ?? 0;

	if (stars < 5) return null;

	return (
		<span className="text-muted-foreground text-xs tabular-nums">
			{formatCompactNumber(stars)}
		</span>
	);
}
