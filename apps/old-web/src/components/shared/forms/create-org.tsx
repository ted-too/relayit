"use client";

import { EmojiPicker } from "@ferrucc-io/emoji-picker";
import {
	RadioGroup,
	RadioGroupIndicator,
	RadioGroupItem,
} from "@radix-ui/react-radio-group";
import type { ButtonProps } from "@repo/old-ui/components/shadcn/button";
import { Button } from "@repo/old-ui/components/shadcn/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@repo/old-ui/components/shadcn/dialog";
import {
	FormErrorMessage,
	useAppForm,
} from "@repo/old-ui/components/shadcn/form";
import { Label } from "@repo/old-ui/components/shadcn/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@repo/old-ui/components/shadcn/popover";
import {
	Tabs,
	TabsContent,
	TabsList,
	TabsTrigger,
} from "@repo/old-ui/components/shadcn/tabs";
import { cn } from "@repo/old-ui/lib/utils";
import {
	type CreateOrganizationRequest,
	createOrganizationSchema,
	ORGANIZATION_LOGO_GRADIENTS,
	type OrganizationLogoGradientKey,
} from "@repo/shared";
import { useStore } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { CircleCheckIcon, PlusIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { Fragment, useCallback } from "react";
import { toast } from "sonner";
import { authClient, type Organization } from "@/lib/auth-client";
import { trpc } from "@/trpc/client";
import { noThrow } from "@/trpc/no-throw";
import { usersOrganizationsQueryKey } from "@/trpc/queries/auth";

type CreateOrganizationFormProps = {
	onSuccess?: (data: { id: string; slug: string }) => void;
	submitWrapper?: typeof DialogFooter;
	initialData?: Organization;
	className?: { root?: string; submit?: string };
};

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
				logoBgKey: initialData?.metadata?.logoBgKey ?? "sky",
				logoEmoji: initialData?.metadata?.logoEmoji ?? "",
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

			if (error) {
				return toast.error(error?.message);
			}

			await queryClient.invalidateQueries({
				queryKey: usersOrganizationsQueryKey,
			});

			if (onSuccess) {
				onSuccess(data);
			}
		},
	});

	const name = useStore(form.store, (state) => state.values.name);

	const generateSlug = useCallback(async () => {
		if (!name || name.length === 0) {
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
	}, [form, name, generateSlugFn]);

	const SubmitWrapper = submitWrapper ?? Fragment;

	return (
		<form
			className={cn("grid w-full gap-4", className?.root)}
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
		>
			<div className="flex items-center gap-4">
				<form.AppField
					children={(field) => (
						<field.TextField
							className={{
								root: "grow",
							}}
							label="Organization Name"
							placeholder="e.g., 2labs"
						/>
					)}
					listeners={{
						onChangeDebounceMs: 250,
						onChange: generateSlug,
					}}
					name="name"
				/>
				<form.Subscribe
					children={(logoBgKey) => (
						<form.Field
							children={(field) => (
								<Popover>
									<div className="grid gap-2">
										<Label htmlFor={field.name}>Logo</Label>
										<PopoverTrigger asChild>
											<Button
												className="size-9 rounded-full text-lg"
												size="icon"
												style={{
													background: logoBgKey
														? ORGANIZATION_LOGO_GRADIENTS[
																logoBgKey as OrganizationLogoGradientKey
															]
														: undefined,
												}}
												variant="outline"
											>
												{field.state.value ?? <PlusIcon />}
											</Button>
										</PopoverTrigger>
										{/* @ts-expect-error - TODO: fix this */}
										<FormErrorMessage errors={field.state.meta.errors} />
									</div>
									<PopoverContent align="end" className="w-svw sm:w-[434px]">
										<Tabs className="w-full" defaultValue="emoji">
											<TabsList className="grid w-full grid-cols-2">
												<TabsTrigger value="emoji">Emoji</TabsTrigger>
												<TabsTrigger value="style">Style</TabsTrigger>
											</TabsList>
											<TabsContent value="emoji">
												<EmojiPicker
													className="border-none shadow-none"
													emojiSize={32}
													onEmojiSelect={field.handleChange}
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
													children={(field) => (
														<RadioGroup
															className="flex min-h-9 flex-wrap items-center gap-4 p-2"
															defaultValue={field.state.value}
															onValueChange={(value) =>
																field.handleChange(
																	value as OrganizationLogoGradientKey
																)
															}
														>
															{Object.entries(ORGANIZATION_LOGO_GRADIENTS).map(
																([key, value]) => (
																	<div
																		className="flex items-center gap-4"
																		key={key}
																	>
																		<RadioGroupItem
																			className="relative aspect-square size-10 cursor-pointer rounded-full border-primary focus:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border"
																			style={{ background: value }}
																			value={key}
																		>
																			<RadioGroupIndicator className="-top-2 -right-2 absolute flex items-center justify-center">
																				<CircleCheckIcon className="size-4 fill-primary stroke-background" />
																			</RadioGroupIndicator>
																		</RadioGroupItem>
																	</div>
																)
															)}
														</RadioGroup>
													)}
													name="metadata.logoBgKey"
												/>
											</TabsContent>
										</Tabs>
									</PopoverContent>
								</Popover>
							)}
							name="metadata.logoEmoji"
						/>
					)}
					selector={(state) => state.values.metadata.logoBgKey}
				/>
			</div>

			<form.AppField
				children={(field) => (
					<field.SlugField
						className={{
							root: "col-span-full",
						}}
						isLoading={isGeneratingSlug}
						label="Organization Slug"
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
						className={button.className}
						size={button.size}
						variant={button.variant}
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
