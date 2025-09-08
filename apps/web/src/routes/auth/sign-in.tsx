import { type SignInRequest, signInSchema } from "@repo/shared";
import { Button } from "@repo/ui/components/base/button";
import { useAppForm } from "@repo/ui/components/custom/form";
import { toast } from "@repo/ui/components/custom/sonner";
import { CombinedLogo } from "@repo/ui/components/shared/logo";
import {
	createFileRoute,
	Link,
	useNavigate,
	useRouteContext,
} from "@tanstack/react-router";

export const Route = createFileRoute("/auth/sign-in")({
	component: RouteComponent,
});

function RouteComponent() {
	const navigate = useNavigate();
	const { auth } = useRouteContext({ from: "/auth" });

	const form = useAppForm({
		defaultValues: {
			email: "",
			password: "",
			rememberMe: true,
		} as SignInRequest,
		validators: {
			onSubmit: signInSchema,
		},
		onSubmit: async ({ value }) => {
			console.log(value);
			const { error } = await auth.signIn.email({
				email: value.email,
				password: value.password,
				rememberMe: value.rememberMe,
			});

			if (error) {
				return toast.error("Failed to sign in", {
					description: error.message,
				});
			}

			toast.success("Signed in successfully");

			navigate({ to: "/auth/setup-org" });
		},
		onSubmitInvalid: ({ value, formApi }) => {
			console.log(value, formApi.state.errors);
		},
	});

	return (
		<div className="relative flex h-full w-full grow items-center justify-center">
			<div className="absolute top-0 right-1/2 flex w-full translate-x-1/2 items-center justify-between text-muted-foreground text-sm lg:right-0 lg:translate-x-0">
				<CombinedLogo />
				<span>
					Don't have an account?{"  "}
					<Link
						className="font-medium text-caribbean hover:underline"
						to="/auth/sign-up"
					>
						Sign Up
					</Link>
				</span>
			</div>
			<form
				className="flex w-full max-w-md flex-col"
				onSubmit={(e) => {
					e.preventDefault();
					form.handleSubmit();
				}}
			>
				<h1 className="mb-1 text-center font-bold text-3xl">Sign in</h1>
				<p className="mb-6 text-center text-muted-foreground">
					Sign in to your account to continue
				</p>
				<div className="mb-6 flex w-full flex-col items-center gap-4 sm:flex-row">
					<Button
						className="h-12 grow"
						onClick={() => {
							auth.signIn.social({
								provider: "google",
								callbackURL: `${import.meta.env.VITE_BASE_URL}/auth/select-household`,
								newUserCallbackURL: `${import.meta.env.VITE_BASE_URL}/auth/finish`,
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
							<title>Google</title>
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
				</div>
				<span className="relative mb-6 flex items-center justify-center text-muted-foreground text-sm before:mr-2 before:flex-1 before:self-center before:border-muted-foreground/20 before:border-t before:content-[''] after:ml-2 after:flex-1 after:self-center after:border-muted-foreground/20 after:border-t after:content-['']">
					Or continue with email address
				</span>
				<div className="flex flex-col gap-4">
					<form.AppField name="email">
						{(field) => <field.TextField label="Email" type="email" />}
					</form.AppField>
					<form.AppField name="password">
						{(field) => <field.TextField label="Password" type="password" />}
					</form.AppField>
					<form.AppForm>
						<form.SubmitButton className="mt-4 w-full" size="lg">
							Sign in
						</form.SubmitButton>
					</form.AppForm>
				</div>
			</form>
		</div>
	);
}
