"use client";
import {
	Button,
	type ButtonProps,
} from "@repo/old-ui/components/shadcn/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@repo/old-ui/components/shadcn/dialog";
import { useAppForm } from "@repo/old-ui/components/shadcn/form";
import { Label } from "@repo/old-ui/components/shadcn/label";
import { Skeleton } from "@repo/old-ui/components/shadcn/skeleton";
import { type CreateApiKeyRequest, createApiKeySchema } from "@repo/shared";
import { useQueryClient } from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { toast } from "sonner";
import { CopyToClipboardContainer } from "@/components/shared/copy-to-clipboard-container";
import { authClient, type CreatedApiKey } from "@/lib/auth-client";
import { apiKeysListQueryKey } from "@/trpc/queries/auth";

type CreateApiKeyFormProps = {
	submitWrapper?: typeof DialogFooter;
	organizationId: string;
};

export function CreateApiKeyForm({
	submitWrapper,
	organizationId,
}: CreateApiKeyFormProps) {
	const queryClient = useQueryClient();
	const [createdApiKey, setCreatedApiKey] = useState<CreatedApiKey | null>(
		null
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

			if (error) {
				return toast.error(error?.message);
			}

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
			className="grid w-full gap-4"
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
		>
			<form.AppField
				children={(field) => (
					<field.TextField
						description="Make sure to copy your API key now. For security reasons, we don't
						store the full key and you won't be able to see it again."
						label="Key Name"
						placeholder="e.g., 2labs"
					/>
				)}
				name="name"
			/>

			{form.state.isSubmitting && !createdApiKey && (
				<Skeleton className="h-10 w-full" />
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
								<Button className="mt-6 w-full" size="lg" type="button">
									Done
								</Button>
							</DialogClose>
						) : (
							<form.SubmitButton className="mt-6 w-full" size="lg">
								Create
							</form.SubmitButton>
						)
					) : (
						<form.SubmitButton
							className="mt-6 w-full"
							disabled={!!createdApiKey}
							size="lg"
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
					<DialogTitle>Create API Key</DialogTitle>
					<DialogDescription>
						Give your API key a name to help you identify it later
					</DialogDescription>
				</DialogHeader>
				<CreateApiKeyForm
					organizationId={organizationId}
					submitWrapper={DialogFooter}
				/>
			</DialogContent>
		</Dialog>
	);
}
