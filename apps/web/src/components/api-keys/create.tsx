"use client";
import { Fragment, useState } from "react";

import { authClient, type CreatedApiKey } from "@/lib/auth-client";
import { useQueryClient } from "@tanstack/react-query";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { createApiKeySchema, type CreateApiKeyRequest } from "@repo/shared";
import { useAppForm } from "@/components/ui/form";
import { apiKeysListQueryKey } from "@/qc/queries/user";
import { PlusIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Label } from "@/components/ui/label";
import { CopyToClipboardContainer } from "@/components/shared/copy-to-clipboard-container";

interface CreateApiKeyFormProps {
	submitWrapper?: typeof DialogFooter;
}

export function CreateApiKeyForm({ submitWrapper }: CreateApiKeyFormProps) {
	const queryClient = useQueryClient();
	const [createdApiKey, setCreatedApiKey] = useState<CreatedApiKey | null>(
		null,
	);

	const form = useAppForm({
		defaultValues: {
			name: "",
			expiresIn: undefined,
		} as CreateApiKeyRequest,
		validators: {
			onSubmit: createApiKeySchema,
		},
		onSubmit: async ({ value }) => {
			const { data, error } = await authClient.apiKey.create({
				...value,
			});

			if (error) return toast.error(error?.message);

			setCreatedApiKey(data);

			await queryClient.invalidateQueries({
				queryKey: apiKeysListQueryKey,
			});

			toast.success("API key created successfully");
		},
	});

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
				children={(field) => (
					<field.TextField
						label="Key Name"
						description="Make sure to copy your API key now. For security reasons, we don't
						store the full key and you won't be able to see it again."
						placeholder="e.g., 2labs"
					/>
				)}
			/>

			{form.state.isSubmitting && !createdApiKey && (
				<Skeleton className="w-full h-10" />
			)}

			{createdApiKey && (
				<div className="grid gap-2">
					<Label>API Key</Label>
					<CopyToClipboardContainer className="wrap-break-word">
						{createdApiKey.key}
					</CopyToClipboardContainer>
				</div>
			)}

			<SubmitWrapper className="col-span-full">
				<form.AppForm>
					{submitWrapper ? (
						createdApiKey !== null ? (
							<DialogClose asChild>
								<Button className="w-full mt-6" size="lg" type="button">
									Done
								</Button>
							</DialogClose>
						) : (
							<form.SubmitButton className="w-full mt-6" size="lg">
								Create
							</form.SubmitButton>
						)
					) : (
						<form.SubmitButton
							className="w-full mt-6"
							size="lg"
							disabled={!!createdApiKey}
						>
							Create
						</form.SubmitButton>
					)}
				</form.AppForm>
			</SubmitWrapper>
		</form>
	);
}

export function CreateApiKeyDialog({
	button = {
		label: "Create",
		variant: "outline",
		size: "default",
	},
	children,
}: {
	button?: {
		label: string;
		variant?: ButtonProps["variant"];
		size?: ButtonProps["size"];
		className?: string;
	};
	children?: React.ReactNode;
}) {
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
					<DialogTitle>Create API Key</DialogTitle>
					<DialogDescription>
						Give your API key a name to help you identify it later
					</DialogDescription>
				</DialogHeader>
				<CreateApiKeyForm submitWrapper={DialogFooter} />
			</DialogContent>
		</Dialog>
	);
}
