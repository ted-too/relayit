"use client";

import { CardContent } from "@repo/ui/components/shadcn/card";
import { Skeleton } from "@repo/ui/components/shadcn/skeleton";
import { apiKeysListQueryOptions } from "@/trpc/queries/auth";
import { useQuery } from "@tanstack/react-query";
import { ApiKeyCard } from "./key";

export function ApiKeysCardContent({
	organizationId,
}: { organizationId: string }) {
	const { data: apiKeys, isPending } = useQuery(apiKeysListQueryOptions());

	return (
		<CardContent className="flex flex-col gap-4">
			{isPending ? (
				Array.from({ length: 2 }).map((_, i) => (
					<Skeleton key={i} className="h-16 w-full rounded-xl" />
				))
			) : !apiKeys || apiKeys.length === 0 ? (
				<div className="flex items-center h-16">
					<p className="text-sm text-muted-foreground">
						No API keys found. Create one to get started.
					</p>
				</div>
			) : (
				apiKeys
					.filter(
						(apiKey) => apiKey.metadata?.organizationId === organizationId,
					)
					.map((apiKey) => <ApiKeyCard key={apiKey.id} apiKey={apiKey} />)
			)}
		</CardContent>
	);
}
