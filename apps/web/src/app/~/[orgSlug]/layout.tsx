import { AppSidebar } from "@/components/layout/app-sidebar";
import { getSidebarStates } from "@/app/~/actions";
import { getQueryClient } from "@/qc/client";
import {
	organizationMemberQueryOptions,
	organizationQueryOptions,
} from "@/qc/queries/user";
import { headers as headersFn } from "next/headers";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

export default async function OrgLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const queryClient = getQueryClient();
	const headers = await headersFn();
	const sidebarStates = await getSidebarStates();

	const currentUserOrg = await queryClient.ensureQueryData(
		organizationQueryOptions({ headers }),
	);

	const currentUserOrgMember = await queryClient.ensureQueryData(
		organizationMemberQueryOptions({ headers }),
	);

	return (
		<HydrationBoundary state={dehydrate(queryClient)}>
			<AppSidebar
				currentUserOrg={currentUserOrg}
				currentUserOrgMember={currentUserOrgMember}
				sidebarStates={sidebarStates}
			>
				{children}
			</AppSidebar>
		</HydrationBoundary>
	);
}
