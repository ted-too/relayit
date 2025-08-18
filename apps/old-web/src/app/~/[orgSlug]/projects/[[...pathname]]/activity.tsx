import type { Project } from "@repo/db";
import { SECONDARY_SIDEBAR_COOKIE_NAME } from "@repo/old-ui/constants";
import { cookies } from "next/headers";
import { MessagesTable } from "@/components/tables/messages";

export async function ActivityTab({ project }: { project: Project }) {
	const cookieStore = await cookies();

	return (
		<MessagesTable
			controlsOpen={
				cookieStore.get(SECONDARY_SIDEBAR_COOKIE_NAME)?.value === "true"
			}
			projectId={project.id}
		/>
	);
}
