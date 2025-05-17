"use client";

import { projectsQueryOptions } from "@/qc/queries/user";
import { CardContent } from "@/components/ui/card";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";
import { ProjectCard } from "./project";

export function ProjectsCardContent() {
	const { data: projects, isPending } = useQuery(projectsQueryOptions());

	return (
		<CardContent className="flex flex-col gap-4">
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
				projects.map((project) => <ProjectCard key={project.id} project={project} />)
			)}
		</CardContent>
	);
}
