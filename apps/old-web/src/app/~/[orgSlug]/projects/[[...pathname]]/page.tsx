import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/shadcn/card";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@repo/ui/components/shadcn/tabs";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { SquareTerminalIcon } from "lucide-react";
import { headers as headersFn } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
// import { WebhooksTab } from "./webhooks";
import type { CSSProperties } from "react";
import { CopyToClipboardContainer } from "@/components/shared/copy-to-clipboard-container";
import { getQueryClient, trpc } from "@/trpc/server";
import { ProjectsPage } from "../landing";
import { ActivityTab } from "./activity";
import { ChannelsTab } from "./channels";
import { GeneralTab } from "./general";

const TABS = [
	{
		label: "General",
		path: [],
		Component: GeneralTab,
	},
	{
		label: "Activity",
		path: ["activity"],
		Component: ActivityTab,
	},
	{
		label: "Channels",
		path: ["channels"],
		Component: ChannelsTab,
	},
	// {
	// 	label: "Webhooks",
	// 	path: ["webhooks"],
	// 	Component: WebhooksTab,
	// },
];

export default async function ProjectPage({
	params,
}: {
	params: Promise<{ pathname: string[] | undefined; orgSlug: string }>;
}) {
	const { pathname, orgSlug } = await params;

	const queryClient = getQueryClient();

	if (!pathname) {
		return <ProjectsPage params={params} />;
	}

	const [slug, ...path] = pathname;

	const headers = await headersFn();

	try {
		const [project, allProviders] = await Promise.all([
			queryClient.ensureQueryData(
				trpc(headers).projects.getBySlug.queryOptions({
					slug,
				})
			),
			queryClient.ensureQueryData(trpc(headers).providers.list.queryOptions()),
		]);

		if (!project) {
			throw notFound();
		}

		return (
			<HydrationBoundary state={dehydrate(queryClient)}>
				<Card
					className="mx-auto h-full max-w-none"
					variant="shadow"
					wrapperProps={{ className: "h-full" }}
				>
					<Tabs className="gap-0" defaultValue={path.join("/")}>
						<CardHeader className="flex flex-row items-center justify-between space-y-0">
							<div className="flex items-center gap-2">
								<CardTitle className="flex items-center gap-2 text-lg md:text-xl">
									{/* TODO: Add icon for project type based on language */}
									<SquareTerminalIcon className="size-4" />
									{project.name}
								</CardTitle>
								<CardDescription className="text-xs md:text-sm">
									<CopyToClipboardContainer variant="no-button">
										{project.slug}
									</CopyToClipboardContainer>
								</CardDescription>
							</div>
							<TabsList>
								{TABS.map(({ label, path }) => (
									<TabsTrigger
										key={`trigger-${path.join("/")}`}
										value={path.join("/")}
									>
										<Link
											href={`/~/${orgSlug}/projects/${slug}/${path.join("/")}`}
										>
											{label}
										</Link>
									</TabsTrigger>
								))}
							</TabsList>
						</CardHeader>
						<CardContent>
							{TABS.map(({ path, Component }) => (
								<TabsContent
									className="mt-2"
									key={`content-${path.join("/")}`}
									style={
										{
											// TBH Don't ask me why this works, but it does.
											// We need to prevent overflow of the content.
											// FIXME: This is a hack and needs to be fixed.
											"--tab-content-height":
												"calc(var(--content-height) - 5.25rem - 0.5rem - 1.25rem - calc(0.625rem*2) - 1.5rem )",
										} as CSSProperties
									}
									value={path.join("/")}
								>
									<Component allProviders={allProviders} project={project} />
								</TabsContent>
							))}
						</CardContent>
					</Tabs>
				</Card>
			</HydrationBoundary>
		);
	} catch (error) {
		if (error instanceof TRPCClientError && error.data.code === "NOT_FOUND") {
			throw notFound();
		}
		throw error;
	}
}
