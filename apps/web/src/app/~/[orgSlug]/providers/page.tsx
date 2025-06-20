import { ProvidersCardContent } from "@/components/notification-providers";
import {
	Card,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/shadcn/card";
import { getQueryClient, trpc } from "@/trpc/server";
import { dehydrate } from "@tanstack/react-query";
import { HydrationBoundary } from "@tanstack/react-query";
import { headers as headersFn } from "next/headers";

export default async function ProvidersPage({
	params,
}: {
	params: Promise<{ orgSlug: string }>;
}) {
	const { orgSlug } = await params;
	const queryClient = getQueryClient();
	const headers = await headersFn();

	void queryClient.prefetchQuery(trpc(headers).providers.list.queryOptions());

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<Card variant="shadow" className="mx-auto">
				<CardHeader>
					<CardTitle className="text-lg md:text-xl">
						Notification Providers
					</CardTitle>
					<CardDescription className="text-xs md:text-sm">
						Manage credentials for the services used to send notifications.
					</CardDescription>
				</CardHeader>
				<ProvidersCardContent />
			</Card>
		</HydrationBoundary>
	);
}
