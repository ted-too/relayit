"use client";
import { useAppForm } from "@/components/ui/form";
import { authClient, type User } from "@/lib/auth-client";
import { type SignUpRequest, signUpSchema } from "@/validations/auth";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CombinedLogo } from "@/components/logo";

export function FinishSocialSignUpForm({
	initialData,
	onSuccess,
	noTitle = false,
	noDescription = false,
}: {
	initialData?: User;
	onSuccess: () => void;
	noTitle?: boolean;
	noDescription?: boolean;
}) {
	const form = useAppForm({
		defaultValues: {
			name: initialData?.name ?? "",
			email: initialData?.email ?? "",
		} as Omit<SignUpRequest, "password">,
		validators: {
			onSubmit: signUpSchema.omit({ password: true }),
		},
		onSubmit: async ({ value }) => {
			const { error } = await authClient.updateUser({
				name: value.name,
			});

			if (error)
				return toast.error("Failed to complete sign up", {
					description: "A user with this phone number already exists",
				});

			toast.success("Sign up completed successfully");

			onSuccess?.();
		},
	});

	return (
		<form
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
			className="w-full max-w-md flex flex-col"
		>
			{!noTitle && (
				<h1 className="text-3xl font-bold mb-1 text-center">
					Complete your Sign Up
				</h1>
			)}
			{!noDescription && (
				<p className="text-center text-muted-foreground mb-6">
					Just a few more details to get started.
				</p>
			)}
			<div className="flex flex-col gap-4">
				<form.AppField
					name="name"
					children={(field) => <field.TextField type="text" label="Name" />}
				/>
				{/* <div className="grid-cols-2 grid gap-4"> */}
				<form.AppField
					name="email"
					children={(field) => (
						<field.TextField
							type="email"
							label="Email"
							disabled={!!initialData?.email}
						/>
					)}
				/>
				{/* </div> */}

				<form.AppForm>
					<form.SubmitButton className="w-full mt-4" size="lg">
						Complete Sign Up
					</form.SubmitButton>
				</form.AppForm>
			</div>
		</form>
	);
}

export function FinishSocialSignUp({ initialData }: { initialData?: User }) {
	const router = useRouter();

	return (
		<div className="relative grow flex items-center justify-center w-full h-full">
			<div className="flex items-center w-full justify-between absolute top-0 right-1/2 lg:translate-x-0 translate-x-1/2 lg:right-0 text-sm text-muted-foreground">
				<CombinedLogo />
				{/* Optional: Link to cancel or go back */}
			</div>
			<FinishSocialSignUpForm
				initialData={initialData}
				onSuccess={() => router.push("/")} // Navigate to dashboard or appropriate page
			/>
		</div>
	);
}
