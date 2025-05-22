import { DeleteProjectDialogContent } from "@/components/projects/create";
import { CopyToClipboardContainer } from "@/components/shared/copy-to-clipboard-container";
import { AlertDialog, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getQueryClient } from "@/trpc/server";
import { trpc } from "@/trpc/server";
import { dehydrate } from "@tanstack/react-query";
import { HydrationBoundary } from "@tanstack/react-query";
import { TRPCClientError } from "@trpc/client";
import { SquareTerminalIcon, TrashIcon } from "lucide-react";
import { headers as headersFn } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectsPage } from "../landing";
import { ActivityTab } from "./activity";
import { ChannelsTab } from "./channels";
import { GeneralTab } from "./general";
import { WebhooksTab } from "./webhooks";

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
	{
		label: "Webhooks",
		path: ["webhooks"],
		Component: WebhooksTab,
	},
];

// This is outside the component to avoid re-creating the query client on every render/switch of tabs
const queryClient = getQueryClient();

export default async function ProjectPage({
	params,
}: {
	params: Promise<{ pathname: string[] | undefined; orgSlug: string }>;
}) {
	const { pathname, orgSlug } = await params;

	if (!pathname) return <ProjectsPage params={params} />;

	const [slug, ...path] = pathname;

	const headers = await headersFn();

	try {
		const [project, allProviders] = await Promise.all([
			queryClient.ensureQueryData(
				trpc(headers).projects.getBySlug.queryOptions({
					slug,
				}),
			),
			queryClient.ensureQueryData(trpc(headers).providers.list.queryOptions()),
		]);

		if (!project) throw notFound();

		return (
			<HydrationBoundary state={dehydrate(queryClient)}>
				<Card
					variant="shadow"
					className="mx-auto max-w-none h-full"
					wrapperProps={{ className: "h-full" }}
				>
					<CardHeader className="border-b flex flex-row items-center justify-between">
						<div className="flex flex-col">
							<CardTitle className="text-lg md:text-xl flex items-center gap-2">
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
						<div className="flex gap-2 items-center">
							{/* <Dialog>
							<DialogTrigger asChild>
								<Button variant="ghost" size="icon">
									<SquarePenIcon />
								</Button>
							</DialogTrigger>
							<DialogContent>
								<DialogHeader>
									<DialogTitle>Edit {project.name}</DialogTitle>
									<DialogDescription>
										Edit your project details
									</DialogDescription>
								</DialogHeader>
								<CreateProjectForm
									submitWrapper={DialogFooter}
									initialData={project}
								/>
							</DialogContent>
						</Dialog> */}
							<AlertDialog>
								<AlertDialogTrigger asChild>
									<Button variant="ghost" size="icon">
										<TrashIcon />
									</Button>
								</AlertDialogTrigger>
								<DeleteProjectDialogContent
									project={project}
									onSuccess="redirect"
								/>
							</AlertDialog>
						</div>
					</CardHeader>
					<CardContent className="pt-6">
						<Tabs defaultValue={path.join("/")}>
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
							{TABS.map(({ path, Component }) => (
								<TabsContent
									key={`content-${path.join("/")}`}
									value={path.join("/")}
									className="mt-2.5"
								>
									<Component project={project} allProviders={allProviders} />
								</TabsContent>
							))}
						</Tabs>
					</CardContent>
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
