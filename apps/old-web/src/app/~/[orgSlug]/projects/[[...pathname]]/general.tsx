import type { Project } from "@repo/db";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/shadcn/card";
import { CreateProjectForm } from "@/components/projects/create";

export function GeneralTab({ project }: { project: Project }) {
	return (
		<div className="flex flex-col gap-2">
			<Card className="max-w-none">
				<CardHeader>
					<CardTitle className="text-2xl leading-none tracking-tight">
						Project
					</CardTitle>
					<CardDescription className="text-sm">
						Manage your project settings
					</CardDescription>
				</CardHeader>
				<CardContent>
					<CreateProjectForm
						className={{
							root: "grid-cols-2",
							submit: "col-span-2 ml-auto w-max",
						}}
						initialData={project}
					/>
				</CardContent>
			</Card>
		</div>
	);
}
