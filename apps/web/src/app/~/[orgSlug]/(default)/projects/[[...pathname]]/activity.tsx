import type { Project } from "@repo/db";
import { MessagesTable } from "@/components/tables/messages";

export function ActivityTab({ project }: { project: Project }) {
	return <MessagesTable projectId={project.id} />;
}
