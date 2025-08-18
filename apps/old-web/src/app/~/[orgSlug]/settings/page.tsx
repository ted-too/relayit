import { Card, CardContent, CardTitle } from "@repo/ui/components/shadcn/card";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";
import { headers as headersFn } from "next/headers";
import Link from "next/link";
import { activeOrganizationQueryOptions } from "@/trpc/queries/auth";
import { getQueryClient, trpc } from "@/trpc/server";
import { MembersSettings } from "./members";
import { OrganizationSettings } from "./organization";

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
			activeOrganizationQueryOptions({ headers })
		),
		await queryClient.ensureQueryData(
			trpc(headers).misc.listMembers.queryOptions()
		),
		await queryClient.ensureQueryData(
			trpc(headers).misc.listOrgInvitations.queryOptions()
		),
	]);

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<Card
				className="mx-auto h-full max-w-none"
				variant="shadow"
				wrapperProps={{ className: "h-full" }}
			>
				<CardContent className="flex w-full grow items-start gap-4 pt-6">
					<div className="flex h-full w-full max-w-64 flex-col items-start gap-2 border-r">
						<CardTitle className="flex items-center gap-2 text-lg md:text-xl">
							Settings
						</CardTitle>
						{SECTIONS.map((section) => (
							<Link
								href={section.path}
								key={`link-${section.label}-${section.path}`}
							>
								{section.label}
							</Link>
						))}
					</div>
					<div className="flex grow flex-col gap-4">
						{SECTIONS.map((section) => (
							<section.Component
								invitations={invitations}
								key={`content-${section.label}-${section.path}`}
								members={members}
								organization={currentUserOrg}
							/>
						))}
					</div>
				</CardContent>
			</Card>
		</HydrationBoundary>
	);
}
