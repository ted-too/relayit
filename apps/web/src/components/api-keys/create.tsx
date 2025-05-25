"use client";
import { Fragment, useState } from "react";

import { CopyToClipboardContainer } from "@/components/shared/copy-to-clipboard-container";
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
import { useAppForm } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { type CreatedApiKey, authClient } from "@/lib/auth-client";
import { apiKeysListQueryKey } from "@/trpc/queries/auth";
import { type CreateApiKeyRequest, createApiKeySchema } from "@repo/shared";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { toast } from "sonner";

interface CreateApiKeyFormProps {
	submitWrapper?: typeof DialogFooter;
	organizationId: string;
}

export function CreateApiKeyForm({
	submitWrapper,
	organizationId,
}: CreateApiKeyFormProps) {
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
				metadata: {
					organizationId,
				},
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
	organizationId,
}: {
	button?: {
		label: string;
		variant?: ButtonProps["variant"];
		size?: ButtonProps["size"];
		className?: string;
	};
	children?: React.ReactNode;
	organizationId: string;
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
				<CreateApiKeyForm
					submitWrapper={DialogFooter}
					organizationId={organizationId}
				/>
			</DialogContent>
		</Dialog>
	);
}
