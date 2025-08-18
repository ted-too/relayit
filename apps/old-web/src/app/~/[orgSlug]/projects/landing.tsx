import { ProjectsCardContent } from "@/components/projects";
import { CreateProjectDialog } from "@/components/projects/create";
import { CopyToClipboardContainer } from "@/components/shared/copy-to-clipboard-container";
import {
	Card,
	CardDescription,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/shadcn/card";
import { getQueryClient, trpc } from "@/trpc/server";
import { dehydrate } from "@tanstack/react-query";
import { HydrationBoundary } from "@tanstack/react-query";
import { headers as headersFn } from "next/headers";

export async function ProjectsPage({
	params,
}: {
	params: Promise<{ orgSlug: string }>;
}) {
	const { orgSlug } = await params;
	const queryClient = getQueryClient();
	const headers = await headersFn();

	void queryClient.prefetchQuery(trpc(headers).projects.list.queryOptions());

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<Card
				variant="shadow"
				className="mx-auto max-w-none h-full"
				wrapperProps={{ className: "h-full" }}
			>
				<CardHeader className="flex flex-row items-center justify-between border-b">
					<div>
						<CardTitle className="text-lg md:text-xl">Projects</CardTitle>
						<CardDescription className="text-xs md:text-sm">
							Manage your projects
						</CardDescription>
					</div>
					<CreateProjectDialog />
				</CardHeader>
				<ProjectsCardContent />
				<CardFooter className="mt-auto rounded-b-xl border-t bg-muted p-6 dark:bg-transparent">
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
