import { headers as headersFn } from "next/headers";
import { redirect } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { apiClient, callRpc } from "@/lib/api";

export async function SetupOrganization() {
	const headers = await headersFn();
	const { data, error } = await callRpc(
		apiClient["init-organization"].$post(undefined, {
			headers: Object.fromEntries(headers),
		}),
	);

	if (error) {
		console.log("Setup org failed: ", error);
		return <div>Something went wrong. Please try again</div>;
	}

	await authClient.organization.setActive({
		organizationId: data.id,
		fetchOptions: {
			headers: Object.fromEntries(headers),
		},
	});

	redirect(`/~/${data.slug}`);
}
