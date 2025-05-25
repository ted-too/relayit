import { ApiKeysCardContent } from "@/components/api-keys";
import { CreateApiKeyDialog } from "@/components/api-keys/create";
import { CopyToClipboardContainer } from "@/components/shared/copy-to-clipboard-container";
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import {
	apiKeysListQueryOptions,
	currentMemberQueryOptions,
} from "@/trpc/queries/auth";
import { getQueryClient } from "@/trpc/server";
import { dehydrate } from "@tanstack/react-query";
import { HydrationBoundary } from "@tanstack/react-query";
import { headers as headersFn } from "next/headers";
import { notFound } from "next/navigation";

export default async function ApiKeysPage({
	params,
}: {
	params: Promise<{ orgSlug: string }>;
}) {
	const { orgSlug } = await params;
	const queryClient = getQueryClient();
	const headers = await headersFn();

	void queryClient.prefetchQuery(apiKeysListQueryOptions({ headers }));

	try {
		const currentMember = await queryClient.ensureQueryData(
			currentMemberQueryOptions({ headers }),
		);

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
						<CreateApiKeyDialog organizationId={currentMember.organizationId} />
					</CardHeader>
					<ApiKeysCardContent organizationId={currentMember.organizationId} />
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
	} catch (error) {
		console.error(error);
		throw notFound();
	}
}
