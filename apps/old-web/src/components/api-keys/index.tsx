"use client";

import { CardContent } from "@repo/old-ui/components/shadcn/card";
import { Skeleton } from "@repo/old-ui/components/shadcn/skeleton";
import { useQuery } from "@tanstack/react-query";
import { apiKeysListQueryOptions } from "@/trpc/queries/auth";
import { ApiKeyCard } from "./key";

export function ApiKeysCardContent({
	organizationId,
}: {
	organizationId: string;
}) {
	const { data: apiKeys, isPending } = useQuery(apiKeysListQueryOptions());

	return (
		<CardContent className="flex flex-col gap-4">
			{isPending ? (
				Array.from({ length: 2 }).map((_, i) => (
					<Skeleton className="h-16 w-full rounded-xl" key={i} />
				))
			) : !apiKeys || apiKeys.length === 0 ? (
				<div className="flex h-16 items-center">
					<p className="text-muted-foreground text-sm">
						No API keys found. Create one to get started.
					</p>
				</div>
			) : (
				apiKeys
					.filter(
						(apiKey) => apiKey.metadata?.organizationId === organizationId
					)
					.map((apiKey) => <ApiKeyCard apiKey={apiKey} key={apiKey.id} />)
			)}
		</CardContent>
	);
}
