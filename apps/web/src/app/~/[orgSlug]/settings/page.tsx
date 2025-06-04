import { Card, CardContent, CardTitle } from "@/components/ui/card";
import { getQueryClient, trpc } from "@/trpc/server";
import { dehydrate } from "@tanstack/react-query";
import { HydrationBoundary } from "@tanstack/react-query";
import { OrganizationSettings } from "./organization";
import Link from "next/link";
import { headers as headersFn } from "next/headers";
import { activeOrganizationQueryOptions } from "@/trpc/queries/auth";
import { MembersSettings } from "./members";

const SECTIONS = [
	{
		label: "Organization",
		path: "#organization",
		Component: OrganizationSettings,
	},
	{
		label: "Members",
		path: "#members",
		Component: MembersSettings,
	},
	// {
	// 	label: "Channels",
	// 	path: ["channels"],
	// 	Component: ChannelsTab,
	// },
	// {
	// 	label: "Webhooks",
	// 	path: ["webhooks"],
	// 	Component: WebhooksTab,
	// },
];

export default async function SettingsPage({
	params,
}: {
	params: Promise<{ orgSlug: string }>;
}) {
	const queryClient = getQueryClient();

	const headers = await headersFn();

	const [currentUserOrg, members, invitations] = await Promise.all([
		await queryClient.ensureQueryData(
			activeOrganizationQueryOptions({ headers }),
		),
		await queryClient.ensureQueryData(
			trpc(headers).misc.listMembers.queryOptions(),
		),
		await queryClient.ensureQueryData(
			trpc(headers).misc.listOrgInvitations.queryOptions(),
		),
	]);

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<Card
				variant="shadow"
				className="mx-auto max-w-none h-full"
				wrapperProps={{ className: "h-full" }}
			>
				<CardContent className="flex w-full items-start gap-4 grow pt-6">
					<div className="flex flex-col items-start w-full gap-2 max-w-64 border-r h-full">
						<CardTitle className="text-lg md:text-xl flex items-center gap-2">
							Settings
						</CardTitle>
						{SECTIONS.map((section) => (
							<Link
								key={`link-${section.label}-${section.path}`}
								href={section.path}
							>
								{section.label}
							</Link>
						))}
					</div>
					<div className="flex flex-col gap-4 grow">
						{SECTIONS.map((section) => (
							<section.Component
								key={`content-${section.label}-${section.path}`}
								organization={currentUserOrg}
								members={members}
								invitations={invitations}
							/>
						))}
					</div>
				</CardContent>
			</Card>
		</HydrationBoundary>
	);
}
