import type { Project } from "@repo/db";
import { MessagesTable } from "@/components/tables/messages";
import { cookies } from "next/headers";
import { SECONDARY_SIDEBAR_COOKIE_NAME } from "@/constants/sidebar";

export async function ActivityTab({ project }: { project: Project }) {
	const cookieStore = await cookies();

	return (
		<MessagesTable
			projectId={project.id}
			controlsOpen={
				cookieStore.get(SECONDARY_SIDEBAR_COOKIE_NAME)?.value === "true"
			}
		/>
	);
}
