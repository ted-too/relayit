import { redirect } from "next/navigation";

export default async function DashboardPage({
	params,
}: {
	params: Promise<{ orgSlug: string }>;
}) {
	const { orgSlug } = await params;
	throw redirect(`/~/${orgSlug}/projects`);
}
