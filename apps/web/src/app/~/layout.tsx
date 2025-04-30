import { authClient } from "@/lib/auth-client";
import { getQueryClient } from "@/qc/client";
import {
	sessionQueryKey,
	userOrganizationsQueryOptions,
} from "@/qc/queries/user";
import { headers as headersFn } from "next/headers";
import { redirect } from "next/navigation";

export default async function DashboardLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	const headers = await headersFn();
	const session = await authClient.getSession({
		fetchOptions: {
			headers,
		},
	});

	if (!session) {
		throw redirect("/auth/sign-in");
	}

	const queryClient = getQueryClient();

	queryClient.setQueryData(sessionQueryKey, session);

	const organizations = await queryClient.ensureQueryData(
		userOrganizationsQueryOptions({ headers }),
	);

	if (organizations.length === 0) {
		throw redirect("/auth/setup-organization");
	}

	return children;
}
