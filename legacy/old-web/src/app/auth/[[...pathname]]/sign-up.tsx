"use client";

import { Button } from "@repo/old-ui/components/shadcn/button";
import { useAppForm } from "@repo/old-ui/components/shadcn/form";
import { type SignUpRequest, signUpSchema } from "@repo/shared";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CombinedLogo } from "@/components/shared/logo";
import { authClient } from "@/lib/auth-client";
import { usersOrganizationsQueryOptions } from "@/trpc/queries/auth";

export function SignUpForm({
	email,
	noTitle = false,
	noDescription = false,
}: {
	email?: string;
	noTitle?: boolean;
	noDescription?: boolean;
}) {
	const router = useRouter();
	const queryClient = useQueryClient();

	const form = useAppForm({
		defaultValues: {
			name: "",
			email: email ?? "",
			password: "",
		} as SignUpRequest,
		validators: {
			onSubmit: signUpSchema,
		},
		onSubmit: async ({ value }) => {
			const { error } = await authClient.signUp.email({
				email: value.email,
				password: value.password,
				name: value.name,
			});

			if (error) {
				return toast.error(error.message);
			}

			toast.success("Signed up successfully");

			const userOrgs = await queryClient.ensureQueryData(
				usersOrganizationsQueryOptions()
			);

			const defaultOrg = userOrgs[0];

			if (!defaultOrg) {
				// This should never happen but to be safe
				return router.push("/auth/setup-organization");
			}

			router.push(`/~/${defaultOrg.slug}`);
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
				<h1 className="mb-1 text-center font-bold text-3xl">Sign up</h1>
			)}
			{!noDescription && (
				<p className="mb-6 text-center text-muted-foreground">
					Sign up to continue
				</p>
			)}
			<div className="mb-6 flex w-full flex-col items-center gap-4 sm:flex-row">
				<Button
					className="h-12 grow"
					onClick={() => {
						authClient.signIn.social({
							provider: "google",
						});
					}}
					size="lg"
					type="button"
					variant="outline"
				>
					<svg
						height="24"
						viewBox="0 0 24 24"
						width="24"
						xmlns="http://www.w3.org/2000/svg"
					>
						<path
							d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
							fill="#4285F4"
						/>
						<path
							d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
							fill="#34A853"
						/>
						<path
							d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
							fill="#FBBC05"
						/>
						<path
							d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
							fill="#EA4335"
						/>
					</svg>
					Google
				</Button>
				{/* <Button variant="outline" size="lg" className="h-12 grow">
					<svg
						role="img"
						viewBox="0 0 24 24"
						xmlns="http://www.w3.org/2000/svg"
					>
						<title>Apple</title>
						<path d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701" />
					</svg>
					Apple ID
				</Button> */}
			</div>
			<span className="relative mb-6 flex items-center justify-center text-muted-foreground text-sm before:mr-2 before:flex-1 before:self-center before:border-muted-foreground/20 before:border-t before:content-[''] after:ml-2 after:flex-1 after:self-center after:border-muted-foreground/20 after:border-t after:content-['']">
				Or continue with email address
			</span>
			<div className="flex flex-col gap-4">
				<div className="grid grid-cols-2 gap-4">
					<form.AppField
						children={(field) => <field.TextField label="Name" type="text" />}
						name="name"
					/>
					<form.AppField
						children={(field) => (
							<field.TextField disabled={!!email} label="Email" type="email" />
						)}
						name="email"
					/>
				</div>
				<form.AppField
					children={(field) => (
						<field.TextField label="Password" type="password" />
					)}
					name="password"
				/>
				<form.AppForm>
					<form.SubmitButton className="mt-4 w-full" size="lg">
						Sign up
					</form.SubmitButton>
				</form.AppForm>
			</div>
		</form>
	);
}

export function SignUp() {
	return (
		<div className="relative flex h-full w-full grow items-center justify-center">
			<div className="absolute top-0 right-1/2 flex w-full translate-x-1/2 items-center justify-between text-muted-foreground text-sm lg:right-0 lg:translate-x-0">
				<CombinedLogo />
				<span>
					Already have an account?{"  "}
					<Link
						className="font-medium text-caribbean hover:underline"
						href="/auth/sign-in"
					>
						Sign In
					</Link>
				</span>
			</div>
			<SignUpForm />
		</div>
	);
}
