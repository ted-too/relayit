"use client";

import { AlertDialog, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Project } from "@repo/db";
import { formatDistanceToNowStrict } from "date-fns";
import {
	EllipsisIcon,
	SquarePenIcon,
	SquareTerminalIcon,
	TrashIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { CreateProjectForm, DeleteProjectDialogContent } from "./create";

export function ProjectCard({ project }: { project: Project }) {
	const pathname = usePathname();
	const [orgSlug] = pathname.split("/").slice(2);
	const [isEditing, setIsEditing] = useState(false);
	const [isDeleting, setIsDeleting] = useState(false);

	return (
		<Link href={`/~/${orgSlug}/projects/${project.slug}`}>
			<Card className="hover:bg-muted transition-colors duration-200">
				<CardHeader>
					<CardTitle className="flex items-center gap-2 justify-between">
						{/* TODO: Add icon for project type based on language */}
						<div className="flex items-center gap-2">
							<SquareTerminalIcon className="size-4" />
							{project.name}
						</div>
						<Dialog open={isEditing} onOpenChange={setIsEditing}>
							<AlertDialog open={isDeleting} onOpenChange={setIsDeleting}>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button variant="ghost" size="icon">
											<EllipsisIcon />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent className="w-56" align="end">
										<DropdownMenuLabel>Actions</DropdownMenuLabel>
										<DropdownMenuSeparator />
										<DropdownMenuGroup>
											<DialogTrigger asChild>
												<DropdownMenuItem
													className="justify-between"
													onClick={(e) => e.stopPropagation()}
												>
													Edit <SquarePenIcon />
												</DropdownMenuItem>
											</DialogTrigger>
											<AlertDialogTrigger asChild>
												<DropdownMenuItem
													variant="destructive"
													className="justify-between"
													onClick={(e) => e.stopPropagation()}
												>
													Delete <TrashIcon />
												</DropdownMenuItem>
											</AlertDialogTrigger>
										</DropdownMenuGroup>
									</DropdownMenuContent>
								</DropdownMenu>
								<DeleteProjectDialogContent
									project={project}
									onSuccess={() => setIsDeleting(false)}
								/>
							</AlertDialog>
							<DialogContent
								onClick={(e) => e.stopPropagation()}
								onKeyDown={(e) => e.stopPropagation()}
							>
								<DialogHeader>
									<DialogTitle>Edit {project.name}</DialogTitle>
									<DialogDescription>
										Edit your project details
									</DialogDescription>
								</DialogHeader>
								<CreateProjectForm
									submitWrapper={DialogFooter}
									initialData={project}
									onSuccess={() => setIsEditing(false)}
								/>
							</DialogContent>
						</Dialog>
					</CardTitle>
				</CardHeader>
				<CardFooter className="flex items-center justify-between pt-4">
					<span className="text-sm">
						Created {formatDistanceToNowStrict(project.createdAt)} ago
					</span>
					<span className="text-sm">
						{project.providerAssociations.length} linked channels
					</span>
				</CardFooter>
			</Card>
		</Link>
	);
}
