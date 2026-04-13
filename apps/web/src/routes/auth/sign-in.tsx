import { type SignInRequest, signInSchema } from "@repo/shared/forms/auth";
import { Badge } from "@repo/ui/components/reui/badge";
import { Button } from "@repo/ui/components/ui/coss/button";
import { useAppForm } from "@repo/ui/components/ui/custom/form";
import { CombinedLogo } from "@repo/ui/components/ui/custom/logo";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";

export const Route = createFileRoute("/auth/sign-in")({
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  const { betterAuth } = Route.useRouteContext();
  const lastMethod = betterAuth.getLastUsedLoginMethod();

  const { mutate: signInWithGitHub, isPending: isSigningInWithGitHub } =
    useMutation({
      mutationFn: async () => {
        const { data, error } = await betterAuth.signIn.social({
          provider: "github",
          disableRedirect: true,
        });

        if (error) {
          throw new Error(error.message);
        }

        return data;
      },
      onSuccess: (data) => {
        if (data.url) {
          window.location.href = data.url;
        }
      },
      onError: (error) => {
        toast.error("Failed to sign in with GitHub", {
          description: error.message,
        });
      },
    });

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
      const { error } = await betterAuth.signIn.email({
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

      navigate({ to: "/" });
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
            className="relative grow"
            isLoading={isSigningInWithGitHub}
            onClick={() => signInWithGitHub()}
            size="lg"
            type="button"
            variant="outline"
          >
            <svg
              role="img"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <title>GitHub</title>
              <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
            </svg>
            GitHub
            {lastMethod === "github" && (
              <Badge
                className="absolute -top-2 -right-8 w-16"
                size="sm"
                variant="success"
              >
                Last used
              </Badge>
            )}
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
            <div className="relative mt-4">
              <form.SubmitButton className={{ root: "w-full" }} size="lg">
                Sign in
              </form.SubmitButton>
              {lastMethod === "email" && (
                <Badge
                  className="absolute -top-2 -right-8 w-16"
                  size="sm"
                  variant="success"
                >
                  Last used
                </Badge>
              )}
            </div>
          </form.AppForm>
        </div>
      </form>
    </div>
  );
}
