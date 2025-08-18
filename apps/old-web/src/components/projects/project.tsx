"use client";

import type { Project } from "@repo/db";
import {
	AlertDialog,
	AlertDialogTrigger,
} from "@repo/ui/components/shadcn/alert-dialog";
import { Button } from "@repo/ui/components/shadcn/button";
import {
	Card,
	CardFooter,
	CardHeader,
	CardTitle,
} from "@repo/ui/components/shadcn/card";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@repo/ui/components/shadcn/dialog";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@repo/ui/components/shadcn/dropdown-menu";
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
			<Card className="transition-colors duration-200 hover:bg-muted">
				<CardHeader>
					<CardTitle className="flex items-center justify-between gap-2">
						{/* TODO: Add icon for project type based on language */}
						<div className="flex items-center gap-2">
							<SquareTerminalIcon className="size-4" />
							{project.name}
						</div>
						<Dialog onOpenChange={setIsEditing} open={isEditing}>
							<AlertDialog onOpenChange={setIsDeleting} open={isDeleting}>
								<DropdownMenu>
									<DropdownMenuTrigger asChild>
										<Button size="icon" variant="ghost">
											<EllipsisIcon />
										</Button>
									</DropdownMenuTrigger>
									<DropdownMenuContent align="end" className="w-56">
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
													className="justify-between"
													onClick={(e) => e.stopPropagation()}
													variant="destructive"
												>
													Delete <TrashIcon />
												</DropdownMenuItem>
											</AlertDialogTrigger>
										</DropdownMenuGroup>
									</DropdownMenuContent>
								</DropdownMenu>
								<DeleteProjectDialogContent
									onSuccess={() => setIsDeleting(false)}
									project={project}
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
									initialData={project}
									onSuccess={() => setIsEditing(false)}
									submitWrapper={DialogFooter}
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
