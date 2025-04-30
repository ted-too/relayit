// "use client";
// import { Button, type ButtonProps } from "@/components/ui/button";
// import {
// 	Dialog,
// 	DialogContent,
// 	DialogDescription,
// 	DialogFooter,
// 	DialogHeader,
// 	DialogTitle,
// 	DialogTrigger,
// } from "@/components/ui/dialog";
// import { useAppForm } from "@/components/ui/form";
// import { apiClient, callRpc } from "@/lib/api";
// import { authClient } from "@/lib/auth-client";
// import { houseHoldsQueryOptions } from "@/qc/queries/user";
// import {
// 	type CreateOrganizationRequest,
// 	createOrganizationSchema,
// } from "@repo/shared";
// import { useQueryClient } from "@tanstack/react-query";
// import { getTimezonesForCountry } from "countries-and-timezones";
// import { useRouter } from "next/navigation";
// import { Fragment } from "react";
// import { toast } from "sonner";

// interface CreateHouseholdFormProps {
// 	onSuccess: (data: { id: string; slug: string }) => void;
// 	submitWrapper?: typeof DialogFooter;
// }

// export function CreateHouseholdForm({
// 	onSuccess,
// 	submitWrapper,
// }: CreateHouseholdFormProps) {
// 	const queryClient = useQueryClient();
// 	const form = useAppForm({
// 		defaultValues: {
// 			name: "",
// 			description: "",
// 			country: "",
// 			timezone: "",
// 			logoBgKey: "sky",
// 			logoEmoji: "",
// 		} as CreateOrganizationRequest,
// 		validators: {
// 			onSubmit: createOrganizationSchema,
// 		},
// 		onSubmit: async ({ value }) => {
// 			const { data, error } = await callRpc(
// 				apiClient.households.$post({ json: value }),
// 			);

// 			if (error)
// 				return toast.error(error?.message, {
// 					description: error?.details.join("\n"),
// 				});

// 			await authClient.organization.setActive({
// 				organizationId: data.id,
// 			});

// 			await queryClient.invalidateQueries({
// 				queryKey: houseHoldsQueryOptions().queryKey,
// 			});

// 			if (onSuccess) onSuccess(data);
// 		},
// 	});

// 	const SubmitWrapper = submitWrapper ?? Fragment;

// 	return (
// 		<form
// 			onSubmit={(e) => {
// 				e.preventDefault();
// 				form.handleSubmit();
// 			}}
// 			className="space-y-4 w-full"
// 		>
// 			<form.AppField
// 				name="name"
// 				children={(field) => (
// 					<field.TextField
// 						label="Household Name"
// 						placeholder="e.g., Smith Family"
// 					/>
// 				)}
// 			/>

// 			<form.AppField
// 				name="country"
// 				children={(field) => (
// 					<field.CountryDropdownField label="Country" required />
// 				)}
// 			/>

// 			<form.Subscribe
// 				selector={(state) => state.values.country}
// 				children={(country) => (
// 					<form.AppField
// 						name="timezone"
// 						children={(field) => (
// 							<field.SelectField
// 								label="Timezone"
// 								placeholder="e.g., America/New_York"
// 								options={
// 									country !== undefined
// 										? (getTimezonesForCountry(country) ?? []).map((tz) => ({
// 												label: `${tz.name} (UTC ${tz.utcOffsetStr})`,
// 												value: tz.name,
// 											}))
// 										: []
// 								}
// 								className={{
// 									input: "w-full",
// 								}}
// 								triggerProps={{
// 									disabled: country === undefined || country === "",
// 									"aria-required": true,
// 								}}
// 							/>
// 						)}
// 					/>
// 				)}
// 			/>

// 			<form.AppField
// 				name="description"
// 				children={(field) => (
// 					<field.TextField
// 						label="Description (Optional)"
// 						placeholder="Tell us about your household"
// 						textarea
// 					/>
// 				)}
// 			/>

// 			<SubmitWrapper>
// 				<form.AppForm>
// 					<form.SubmitButton className="w-full mt-6" size="lg">
// 						Create Household
// 					</form.SubmitButton>
// 				</form.AppForm>
// 			</SubmitWrapper>
// 		</form>
// 	);
// }

// export function CreateHouseholdDialog({
// 	button = {
// 		label: "Create Household",
// 		variant: "outline",
// 		size: "default",
// 	},
// 	onSuccess: onSuccessProp,
// 	children,
// }: {
// 	button?: {
// 		label: string;
// 		variant?: ButtonProps["variant"];
// 		size?: ButtonProps["size"];
// 		className?: string;
// 	};
// 	onSuccess?: CreateHouseholdFormProps["onSuccess"];
// 	children?: React.ReactNode;
// }) {
// 	const router = useRouter();
// 	const onSuccess =
// 		onSuccessProp ??
// 		(({ slug }) => {
// 			router.push(`/~/${slug}`);
// 		});

// 	return (
// 		<Dialog>
// 			<DialogTrigger asChild>
// 				{children ?? (
// 					<Button
// 						variant={button.variant}
// 						className={button.className}
// 						size={button.size}
// 					>
// 						{button.label}
// 					</Button>
// 				)}
// 			</DialogTrigger>
// 			<DialogContent className="sm:max-w-[425px]">
// 				<DialogHeader>
// 					<DialogTitle>Create Household</DialogTitle>
// 					<DialogDescription>
// 						Create a household to manage chores, bills, and members
// 					</DialogDescription>
// 				</DialogHeader>
// 				<CreateHouseholdForm
// 					onSuccess={onSuccess}
// 					submitWrapper={DialogFooter}
// 				/>
// 			</DialogContent>
// 		</Dialog>
// 	);
// }

// export function CreateHouseholdClient() {
// 	const router = useRouter();
// 	const onSuccess = ({ slug }: { slug: string }) => {
// 		router.push(`/~/${slug}`);
// 	};

// 	return <CreateHouseholdForm onSuccess={onSuccess} />;
// }
