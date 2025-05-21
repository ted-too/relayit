import type { Session } from "@/lib/auth-client";
import { getQueryClient } from "@/trpc/server";
import { sessionQueryKey, sessionQueryOptions } from "@/trpc/queries/auth";
import { usersOrganizationsQueryOptions } from "@/trpc/queries/auth";
import { headers as headersFn } from "next/headers";
import { redirect } from "next/navigation";

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
			sessionQueryOptions({ headers }),
		);
		if (!session) throw new Error("No session");
	} catch (error) {
		console.error(error);
		throw redirect("/auth/sign-in");
	}

	queryClient.setQueryData(sessionQueryKey, session);

	const organizations = await queryClient.ensureQueryData(
		usersOrganizationsQueryOptions({ headers }),
	);

	if (organizations.length === 0) {
		throw redirect("/auth/setup-organization");
	}

	return children;
}
