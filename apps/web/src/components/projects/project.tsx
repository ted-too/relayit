"use client";

import type { Project } from "@repo/db";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ProjectCard({ project }: { project: Project }) {
	return (
		<Card>
			<CardHeader>
				<CardTitle>{project.name}</CardTitle>
			</CardHeader>
			<CardContent>
				<p>Hello</p>
			</CardContent>
		</Card>
	);
}
