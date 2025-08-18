"use client";

import { CardContent } from "@repo/ui/components/shadcn/card";
import { Skeleton } from "@repo/ui/components/shadcn/skeleton";
import { trpc } from "@/trpc/client";
import { ProjectCard } from "./project";

export function ProjectsCardContent() {
	const { data: projects, isPending } = trpc.projects.list.useQuery();

	return (
		<CardContent className="mt-6 grid grid-cols-3 gap-4">
			{isPending ? (
				Array.from({ length: 2 }).map((_, i) => (
					<Skeleton className="h-16 w-full rounded-xl" key={i} />
				))
			) : !projects || projects.length === 0 ? (
				<div className="flex h-16 items-center">
					<p className="text-muted-foreground text-sm">
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
