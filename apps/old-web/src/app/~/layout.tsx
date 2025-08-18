import { headers as headersFn } from "next/headers";
import { redirect } from "next/navigation";
import type { Session } from "@/lib/auth-client";
import {
	sessionQueryKey,
	sessionQueryOptions,
	usersOrganizationsQueryOptions,
} from "@/trpc/queries/auth";
import { getQueryClient } from "@/trpc/server";

export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const headers = await headersFn();
	const queryClient = getQueryClient();

	let session: Session | undefined;

	try {
		session = await queryClient.ensureQueryData(
			sessionQueryOptions({ headers })
		);
		if (!session) {
			throw new Error("No session");
		}
	} catch (_error) {
		throw redirect("/auth/sign-in");
	}

	queryClient.setQueryData(sessionQueryKey, session);

	const organizations = await queryClient.ensureQueryData(
		usersOrganizationsQueryOptions({ headers })
	);

	if (organizations.length === 0) {
		throw redirect("/auth/setup-organization");
	}

	return children;
}
