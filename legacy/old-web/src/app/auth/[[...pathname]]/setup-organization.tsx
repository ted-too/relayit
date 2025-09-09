import { headers as headersFn } from "next/headers";
import { redirect } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { trpcClient } from "@/trpc/server";

export async function SetupOrganization() {
	const headers = await headersFn();

	const { id, slug } = await trpcClient(headers).misc.initOrganization.mutate();

	await authClient.organization.setActive({
		organizationId: id,
		fetchOptions: {
			headers: Object.fromEntries(headers),
		},
	});

	redirect(`/~/${slug}`);
}
