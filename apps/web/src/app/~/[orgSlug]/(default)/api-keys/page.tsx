import { getQueryClient } from "@/qc/client";
import { apiKeysListQueryOptions } from "@/qc/queries/user";
import { dehydrate } from "@tanstack/react-query";
import { HydrationBoundary } from "@tanstack/react-query";
import { headers as headersFn } from "next/headers";
import { CopyToClipboardContainer } from "@/components/shared/copy-to-clipboard-container";
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { CreateApiKeyDialog } from "@/components/api-keys/create";
import { ApiKeysCardContent } from "@/components/api-keys";

export default async function ApiKeysPage({
	params,
}: {
	params: Promise<{ orgSlug: string }>;
}) {
	const { orgSlug } = await params;
	const queryClient = getQueryClient();
	const headers = await headersFn();

	void queryClient.prefetchQuery(apiKeysListQueryOptions({ headers }));

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<Card variant="shadow" className="mx-auto">
				<CardHeader className="flex flex-row items-center justify-between">
					<div>
						<CardTitle className="text-lg md:text-xl">API Keys</CardTitle>
						<CardDescription className="text-xs md:text-sm">
							Manage your API keys for programmatic access
						</CardDescription>
					</div>
					<CreateApiKeyDialog />
				</CardHeader>
				<ApiKeysCardContent />
				<CardFooter className="rounded-b-xl border-t bg-muted p-6 dark:bg-transparent">
					<CardDescription className="text-xs md:text-sm h-max flex items-center gap-2">
						Organization Slug:
						<CopyToClipboardContainer
							align="horizontal"
							side="right"
							inset="outside"
							sideOffset={32}
						>
							{orgSlug}
						</CopyToClipboardContainer>
					</CardDescription>
				</CardFooter>
			</Card>
		</HydrationBoundary>
	);
}
