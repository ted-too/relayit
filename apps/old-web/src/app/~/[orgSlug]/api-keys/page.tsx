import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/shadcn/card";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { headers as headersFn } from "next/headers";
import { notFound } from "next/navigation";
import { ApiKeysCardContent } from "@/components/api-keys";
import { CreateApiKeyDialog } from "@/components/api-keys/create";
import { CopyToClipboardContainer } from "@/components/shared/copy-to-clipboard-container";
import {
	apiKeysListQueryOptions,
	currentMemberQueryOptions,
} from "@/trpc/queries/auth";
import { getQueryClient } from "@/trpc/server";

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
			currentMemberQueryOptions({ headers })
		);

		return (
			<HydrationBoundary state={dehydrate(queryClient)}>
				<Card className="mx-auto" variant="shadow">
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
						<CardDescription className="flex h-max items-center gap-2 text-xs md:text-sm">
							Organization Slug:
							<CopyToClipboardContainer
								align="horizontal"
								inset="outside"
								side="right"
								sideOffset={32}
							>
								{orgSlug}
							</CopyToClipboardContainer>
						</CardDescription>
					</CardFooter>
				</Card>
			</HydrationBoundary>
		);
	} catch (_error) {
		throw notFound();
	}
}
