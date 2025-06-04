"use client";

import type { ButtonProps } from "@/components/ui/button";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { FormErrorMessage, useAppForm } from "@/components/ui/form";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { authClient, type Organization } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/client";
import { noThrow } from "@/trpc/no-throw";
import { usersOrganizationsQueryKey } from "@/trpc/queries/auth";
import { EmojiPicker } from "@ferrucc-io/emoji-picker";
import {
	RadioGroup,
	RadioGroupIndicator,
	RadioGroupItem,
} from "@radix-ui/react-radio-group";
import {
	type CreateOrganizationRequest,
	createOrganizationSchema,
} from "@repo/shared";
import {
	ORGANIZATION_LOGO_GRADIENTS,
	type OrganizationLogoGradientKey,
} from "@repo/shared";
import { useStore } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheckIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback } from "react";
import { toast } from "sonner";

interface CreateOrganizationFormProps {
	onSuccess?: (data: { id: string; slug: string }) => void;
	submitWrapper?: typeof DialogFooter;
	initialData?: Organization;
	className?: { root?: string; submit?: string };
}

export function CreateOrganizationForm({
	onSuccess,
	submitWrapper,
	initialData,
	className,
}: CreateOrganizationFormProps) {
	const queryClient = useQueryClient();
	const { mutateAsync: generateSlugFn, isPending: isGeneratingSlug } =
		trpc.misc.generateOrgSlug.useMutation();

	const form = useAppForm({
		defaultValues: {
			name: initialData?.name ?? "",
			slug: initialData?.slug ?? "",
			metadata: {
				logoBgKey: initialData?.metadata.logoBgKey ?? "sky",
				logoEmoji: initialData?.metadata.logoEmoji ?? "",
			},
		} as CreateOrganizationRequest,
		validators: {
			onSubmit: createOrganizationSchema,
		},
		onSubmit: async ({ value }) => {
			const { data, error } = await (initialData
				? authClient.organization.update({
						data: value,
					})
				: authClient.organization.create({
						...value,
						keepCurrentActiveOrganization: false,
					}));

			if (error) return toast.error(error?.message);

			await queryClient.invalidateQueries({
				queryKey: usersOrganizationsQueryKey,
			});

			if (onSuccess) onSuccess(data);
		},
	});

	const name = useStore(form.store, (state) => state.values.name);

	const generateSlug = useCallback(async () => {
		if (!name || name.length === 0) return;

		const { data } = await noThrow(
			generateSlugFn({
				name,
			}),
		);

		if (data) {
			form.setFieldValue("slug", data.slug);
		}
	}, [form, name]);

	const SubmitWrapper = submitWrapper ?? Fragment;

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
			className={cn("grid gap-4 w-full", className?.root)}
		>
			<div className="flex items-center gap-4">
				<form.AppField
					name="name"
					listeners={{
						onChangeDebounceMs: 250,
						onChange: generateSlug,
					}}
					children={(field) => (
						<field.TextField
							label="Organization Name"
							placeholder="e.g., 2labs"
							className={{
								root: "grow",
							}}
						/>
					)}
				/>
				<form.Subscribe
					selector={(state) => state.values.metadata.logoBgKey}
					children={(logoBgKey) => (
						<form.Field
							name="metadata.logoEmoji"
							children={(field) => (
								<Popover>
									<div className="grid gap-2">
										<Label htmlFor={field.name}>Logo</Label>
										<PopoverTrigger asChild>
											<Button
												variant="outline"
												className="rounded-full size-9 text-2xl"
												size="icon"
												style={{
													background: logoBgKey
														? ORGANIZATION_LOGO_GRADIENTS[
																logoBgKey as OrganizationLogoGradientKey
															]
														: undefined,
												}}
											>
												{field.state.value ?? <PlusIcon />}
											</Button>
										</PopoverTrigger>
										{/* @ts-expect-error - TODO: fix this */}
										<FormErrorMessage errors={field.state.meta.errors} />
									</div>
									<PopoverContent className="sm:w-[434px] w-svw" align="end">
										<Tabs defaultValue="emoji" className="w-full">
											<TabsList className="w-full grid grid-cols-2">
												<TabsTrigger value="emoji">Emoji</TabsTrigger>
												<TabsTrigger value="style">Style</TabsTrigger>
											</TabsList>
											<TabsContent value="emoji">
												<EmojiPicker
													onEmojiSelect={field.handleChange}
													className="shadow-none border-none"
													emojiSize={32}
												>
													<EmojiPicker.Header>
														<EmojiPicker.Input placeholder="Search emoji" />
													</EmojiPicker.Header>
													<EmojiPicker.Group>
														<EmojiPicker.List />
													</EmojiPicker.Group>
												</EmojiPicker>
											</TabsContent>
											<TabsContent value="style">
												<form.Field
													name="metadata.logoBgKey"
													children={(field) => (
														<RadioGroup
															onValueChange={(value) =>
																field.handleChange(
																	value as OrganizationLogoGradientKey,
																)
															}
															defaultValue={field.state.value}
															className="flex flex-wrap gap-4 min-h-9 items-center p-2"
														>
															{Object.entries(ORGANIZATION_LOGO_GRADIENTS).map(
																([key, value]) => (
																	<div
																		key={key}
																		className="flex items-center gap-4"
																	>
																		<RadioGroupItem
																			className="aspect-square cursor-pointer relative size-10 rounded-full focus:outline-none data-[state=checked]:border border-primary focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
																			style={{ background: value }}
																			value={key}
																		>
																			<RadioGroupIndicator className="flex items-center justify-center absolute -top-2 -right-2">
																				<CircleCheckIcon className="size-4 fill-primary stroke-background" />
																			</RadioGroupIndicator>
																		</RadioGroupItem>
																	</div>
																),
															)}
														</RadioGroup>
													)}
												/>
											</TabsContent>
										</Tabs>
									</PopoverContent>
								</Popover>
							)}
						/>
					)}
				/>
			</div>

			<form.AppField
				name="slug"
				children={(field) => (
					<field.SlugField
						label="Organization Slug"
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
					<form.SubmitButton
						className={cn("w-full mt-6", className?.submit)}
						size="lg"
					>
						{initialData ? "Update Organization" : "Create Organization"}
					</form.SubmitButton>
				</form.AppForm>
			</SubmitWrapper>
		</form>
	);
}

export function CreateOrganizationDialog({
	button = {
		label: "Create Organization",
		variant: "outline",
		size: "default",
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
	onSuccess?: CreateOrganizationFormProps["onSuccess"];
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
						{button.label}
					</Button>
				)}
			</DialogTrigger>
			<DialogContent className="sm:max-w-[425px]">
				<DialogHeader>
					<DialogTitle>Create Organization</DialogTitle>
					<DialogDescription>
						Create an organization to manage projects and providers.
					</DialogDescription>
				</DialogHeader>
				<CreateOrganizationForm
					onSuccess={onSuccess}
					submitWrapper={DialogFooter}
				/>
			</DialogContent>
		</Dialog>
	);
}
