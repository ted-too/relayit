import { AppSidebar } from "@/components/layout/app-sidebar";
import {
	SECONDARY_SIDEBAR_COOKIE_NAME,
	SIDEBAR_COOKIE_NAME,
} from "@/constants/sidebar";
import {
	activeOrganizationQueryOptions,
	currentMemberQueryOptions,
} from "@/trpc/queries/auth";
import { getQueryClient } from "@/trpc/server";
import { HydrationBoundary, dehydrate } from "@tanstack/react-query";
import { cookies, headers as headersFn } from "next/headers";

export default async function OrgLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const queryClient = getQueryClient();
	const headers = await headersFn();
	const cookieStore = await cookies();
	const sidebarStates = {
		sidebarState: cookieStore.get(SIDEBAR_COOKIE_NAME)?.value === "true",
		subSidebarState:
			cookieStore.get(SECONDARY_SIDEBAR_COOKIE_NAME)?.value === "true",
	};

	const currentUserOrg = await queryClient.ensureQueryData(
		activeOrganizationQueryOptions({ headers }),
	);

	const currentUserOrgMember = await queryClient.ensureQueryData(
		currentMemberQueryOptions({ headers }),
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
