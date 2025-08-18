"use client";

import type { Project } from "@repo/db";
import { type CreateProjectInput, createProjectSchema } from "@repo/shared";
import {
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@repo/ui/components/shadcn/alert-dialog";
import { Button, type ButtonProps } from "@repo/ui/components/shadcn/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@repo/ui/components/shadcn/dialog";
import { useAppForm } from "@repo/ui/components/shadcn/form";
import { cn } from "@repo/ui/lib/utils";
import { useStore } from "@tanstack/react-form";
import { PlusIcon } from "lucide-react";
import { usePathname, useRouter } from "next/navigation";
import { Fragment, useCallback } from "react";
import { toast } from "sonner";
import { getChangedFields } from "@/lib/utils";
import { trpc } from "@/trpc/client";
import { noThrow } from "@/trpc/no-throw";

type CreateProjectFormProps = {
	onSuccess?: (data: { id: string; slug: string }) => void;
	submitWrapper?: typeof DialogFooter;
	initialData?: Project;
	className?: { root?: string; submit?: string };
};

export function CreateProjectForm({
	submitWrapper,
	onSuccess,
	initialData,
	className,
}: CreateProjectFormProps) {
	const utils = trpc.useUtils();
	const { mutateAsync: createProject } = trpc.projects.create.useMutation({
		onSuccess: () => {
			utils.projects.list.invalidate();
		},
	});
	const { mutateAsync: updateProject } = trpc.projects.update.useMutation({
		onSuccess: () => {
			utils.projects.list.invalidate();
		},
	});
	const { mutateAsync: generateSlugFn, isPending: isGeneratingSlug } =
		trpc.projects.generateSlug.useMutation();

	const form = useAppForm({
		defaultValues: {
			name: initialData?.name ?? "",
			slug: initialData?.slug ?? "",
			// TODO: Add metadata
		} as CreateProjectInput,
		validators: {
			onSubmit: createProjectSchema,
		},
		onSubmit: async ({ value }) => {
			const { data, error } = await noThrow(
				initialData
					? updateProject({
							...getChangedFields(value, initialData),
							projectId: initialData.id,
						})
					: createProject(value)
			);

			if (error) {
				return toast.error(error?.message);
			}

			if (onSuccess) {
				onSuccess(data as { id: string; slug: string });
			}
		},
	});

	const name = useStore(form.store, (state) => state.values.name);

	const generateSlug = useCallback(async () => {
		if (!name || name.length === 0) {
			return;
		}

		if (initialData?.slug) {
			return;
		}

		const { data } = await noThrow(
			generateSlugFn({
				name,
			})
		);

		if (data) {
			form.setFieldValue("slug", data.slug);
		}
	}, [form, name, initialData?.slug, generateSlugFn]);

	const SubmitWrapper = submitWrapper ?? Fragment;

	return (
		<form
			className={cn("grid w-full gap-4", className?.root)}
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
		>
			<form.AppField
				children={(field) => (
					<field.TextField
						className={{
							root: "grow",
						}}
						label="Project Name"
						placeholder="e.g., My Project"
					/>
				)}
				listeners={{
					onChangeDebounceMs: 250,
					onChange: generateSlug,
				}}
				name="name"
			/>

			<form.AppField
				children={(field) => (
					<field.SlugField
						isLoading={isGeneratingSlug}
						label="Project Slug"
						regenerate={generateSlug}
					/>
				)}
				name="slug"
			/>

			<SubmitWrapper className="col-span-full">
				<form.AppForm>
					<form.SubmitButton
						className={cn("mt-6 w-full", className?.submit)}
						size="lg"
					>
						{initialData ? "Update Project" : "Create Project"}
					</form.SubmitButton>
				</form.AppForm>
			</SubmitWrapper>
		</form>
	);
}

export function CreateProjectDialog({
	button = {
		label: "Create Project",
		variant: "default",
		size: "lg",
	},
	onSuccess: onSuccessProp,
	children,
}: {
	button?: {
		label: string;
		variant?: ButtonProps["variant"];
		size?: ButtonProps["size"];
		className?: string;
	};
	onSuccess?: CreateProjectFormProps["onSuccess"];
	children?: React.ReactNode;
}) {
	const router = useRouter();
	const pathname = usePathname();

	const [orgSlug] = pathname.split("/").slice(2);

	const onSuccess =
		onSuccessProp ??
		(({ slug }) => {
			router.push(`/~/${orgSlug}/${slug}`);
		});

	return (
		<Dialog>
			<DialogTrigger asChild>
				{children ?? (
					<Button
						className={button.className}
						size={button.size}
						variant={button.variant}
					>
						<PlusIcon />
						{button.label}
					</Button>
				)}
			</DialogTrigger>
			<DialogContent className="sm:max-w-[500px]">
				<DialogHeader>
					<DialogTitle>Create Project</DialogTitle>
					<DialogDescription>
						Give your project a name to help you identify it later
					</DialogDescription>
				</DialogHeader>
				<CreateProjectForm onSuccess={onSuccess} submitWrapper={DialogFooter} />
			</DialogContent>
		</Dialog>
	);
}

export function DeleteProjectDialogContent({
	project,
	onSuccess,
}: {
	project: Project;
	onSuccess?: (() => void) | "redirect";
}) {
	const router = useRouter();
	const pathname = usePathname();

	const [orgSlug] = pathname.split("/").slice(2);

	const utils = trpc.useUtils();
	const { mutateAsync: deleteProject } = trpc.projects.delete.useMutation({
		onSuccess: () => {
			utils.projects.list.invalidate();
		},
	});

	const handleDelete = async () => {
		const { error } = await noThrow(deleteProject({ projectId: project.id }));
		if (error) {
			return toast.error(error?.message);
		}
		if (onSuccess === "redirect") {
			router.push(`/~/${orgSlug}`);
		} else if (onSuccess) {
			onSuccess();
		}
	};

	return (
		<AlertDialogContent
			onClick={(e) => e.stopPropagation()}
			onKeyDown={(e) => e.stopPropagation()}
		>
			<AlertDialogHeader>
				<AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
				<AlertDialogDescription>
					This action cannot be undone. This will permanently delete `
					{project.name}` from your organization.
				</AlertDialogDescription>
			</AlertDialogHeader>
			<AlertDialogFooter>
				<AlertDialogCancel>Cancel</AlertDialogCancel>
				<AlertDialogAction onClick={handleDelete} variant="destructive">
					Delete
				</AlertDialogAction>
			</AlertDialogFooter>
		</AlertDialogContent>
	);
}
