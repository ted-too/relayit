import { AppSidebar } from "@/components/layout/app-sidebar";
import {
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
				sidebarOpen={cookieStore.get(SIDEBAR_COOKIE_NAME)?.value === "true"}
			>
				{children}
			</AppSidebar>
		</HydrationBoundary>
	);
}
