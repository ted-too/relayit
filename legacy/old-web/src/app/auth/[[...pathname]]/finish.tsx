"use client";
import { useAppForm } from "@repo/old-ui/components/shadcn/form";
import { type SignUpRequest, signUpSchema } from "@repo/shared";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CombinedLogo } from "@/components/shared/logo";
import { authClient, type User } from "@/lib/auth-client";

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

			if (error) {
				return toast.error("Failed to complete sign up", {
					description: "A user with this phone number already exists",
				});
			}

			toast.success("Sign up completed successfully");

			onSuccess?.();
		},
	});

	return (
		<form
			className="flex w-full max-w-md flex-col"
			onSubmit={(e) => {
				e.preventDefault();
				form.handleSubmit();
			}}
		>
			{!noTitle && (
				<h1 className="mb-1 text-center font-bold text-3xl">
					Complete your Sign Up
				</h1>
			)}
			{!noDescription && (
				<p className="mb-6 text-center text-muted-foreground">
					Just a few more details to get started.
				</p>
			)}
			<div className="flex flex-col gap-4">
				<form.AppField
					children={(field) => <field.TextField label="Name" type="text" />}
					name="name"
				/>
				{/* <div className="grid-cols-2 grid gap-4"> */}
				<form.AppField
					children={(field) => (
						<field.TextField
							disabled={!!initialData?.email}
							label="Email"
							type="email"
						/>
					)}
					name="email"
				/>
				{/* </div> */}

				<form.AppForm>
					<form.SubmitButton className="mt-4 w-full" size="lg">
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
		<div className="relative flex h-full w-full grow items-center justify-center">
			<div className="absolute top-0 right-1/2 flex w-full translate-x-1/2 items-center justify-between text-muted-foreground text-sm lg:right-0 lg:translate-x-0">
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
