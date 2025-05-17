"use client";

import type { Project } from "@/qc/queries/user";

export function ProjectCard({ project }: { project: Project }) {
	return <div>{project.name}</div>;
}
