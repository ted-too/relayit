"use client";

import { CardContent } from "@repo/ui/components/shadcn/card";
import { Skeleton } from "@repo/ui/components/shadcn/skeleton";
import { trpc } from "@/trpc/client";
import { ProjectCard } from "./project";

export function ProjectsCardContent() {
	const { data: projects, isPending } = trpc.projects.list.useQuery();

	return (
		<CardContent className="grid grid-cols-3 gap-4 mt-6">
			{isPending ? (
				Array.from({ length: 2 }).map((_, i) => (
					<Skeleton key={i} className="h-16 w-full rounded-xl" />
				))
			) : !projects || projects.length === 0 ? (
				<div className="flex items-center h-16">
					<p className="text-sm text-muted-foreground">
						No projects found. Create one to get started.
					</p>
				</div>
			) : (
				projects.map((project) => (
					<ProjectCard key={project.id} project={project} />
				))
			)}
		</CardContent>
	);
}
