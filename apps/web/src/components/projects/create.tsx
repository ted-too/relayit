"use client";

import { Fragment, useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { type CreateProjectInput, createProjectSchema } from "@repo/shared";
import { useAppForm } from "@/components/ui/form";
import { projectsQueryKey } from "@/qc/queries/user";
import { PlusIcon } from "lucide-react";
import { callRpc } from "@/lib/api";
import { apiClient } from "@/lib/api";
import { useStore } from "@tanstack/react-form";
import { useRouter } from "next/navigation";

interface CreateProjectFormProps {
	onSuccess: (data: { id: string; slug: string }) => void;
	submitWrapper?: typeof DialogFooter;
}

export function CreateProjectForm({
	submitWrapper,
	onSuccess,
}: CreateProjectFormProps) {
	const queryClient = useQueryClient();
	const [isGeneratingSlug, setIsGeneratingSlug] = useState(false);

	const form = useAppForm({
		defaultValues: {
			name: "",
			slug: "",
		} as CreateProjectInput,
		validators: {
			onSubmit: createProjectSchema,
		},
		onSubmit: async ({ value }) => {
			const { data, error } = await callRpc(
				apiClient.projects.$post({
					json: value,
				}),
			);

			if (error) return toast.error(error?.message);

			await queryClient.invalidateQueries({
				queryKey: projectsQueryKey,
			});

			if (onSuccess) onSuccess(data as { id: string; slug: string });
		},
	});

	const name = useStore(form.store, (state) => state.values.name);

	const generateSlug = useCallback(async () => {
		if (!name || name.length === 0) return;

		setIsGeneratingSlug(true);
		const { data } = await callRpc(
			apiClient.projects["generate-slug"].$post({
				json: {
					name,
				},
			}),
		);

		if (data) {
			form.setFieldValue("slug", data.slug);
		}

		setIsGeneratingSlug(false);
	}, [form, name]);

	const SubmitWrapper = submitWrapper ?? Fragment;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
			className="grid gap-4 w-full"
		>
			<form.AppField
				name="name"
				listeners={{
					onChangeDebounceMs: 250,
					onChange: generateSlug,
				}}
				children={(field) => (
					<field.TextField
						label="Project Name"
						placeholder="e.g., My Project"
						className={{
							root: "grow",
						}}
					/>
				)}
			/>

			<form.AppField
				name="slug"
				children={(field) => (
					<field.SlugField
						label="Project Slug"
						isLoading={isGeneratingSlug}
						regenerate={generateSlug}
						className={{
							root: "col-span-full",
						}}
					/>
				)}
			/>

			<SubmitWrapper className="col-span-full">
				<form.AppForm>
					<form.SubmitButton className="w-full mt-6" size="lg">
						Create Project
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
	const onSuccess =
		onSuccessProp ??
		(({ slug }) => {
			router.push(`/~/${slug}`);
		});

	return (
		<Dialog>
			<DialogTrigger asChild>
				{children ?? (
					<Button
						variant={button.variant}
						className={button.className}
						size={button.size}
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
				<CreateProjectForm submitWrapper={DialogFooter} onSuccess={onSuccess} />
			</DialogContent>
		</Dialog>
	);
}
