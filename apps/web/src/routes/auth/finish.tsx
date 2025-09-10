import {
  type CreateOrganizationRequest,
  createOrganizationSchema,
} from "@repo/shared/forms";
import { useAppForm } from "@repo/ui/components/custom/form";
import { toast } from "@repo/ui/components/custom/sonner";
import { useMutation } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useTRPC } from "@/integrations/trpc/react";

export const Route = createFileRoute("/auth/finish")({
  component: RouteComponent,
});

function RouteComponent() {
  const trpc = useTRPC();
  const createProject = useMutation(trpc.auth.createProject.mutationOptions());

  const form = useAppForm({
    defaultValues: {
      name: "",
    } as CreateOrganizationRequest,
    validators: {
      onSubmit: createOrganizationSchema,
    },
    onSubmit: async ({ value }) => {
      const { error } = await createProject.mutateAsync({
        name: value.name,
      });

      if (error) {
        return toast.error("Failed to create project", {
          description: error.message,
        });
      }
      // const { error } = await auth.signIn.email({
      //   email: value.email,
      //   password: value.password,
      //   rememberMe: value.rememberMe,
      // });
      // if (error) {
      //   return toast.error("Failed to sign in", {
      //     description: error.message,
      //   });
      // }
      // toast.success("Signed in successfully");
      // navigate({ to: "/auth/finish" });
    },
  });

  return (
    <div className="flex h-full w-full items-center justify-center">
      <form
        className="flex w-full max-w-md flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <h1 className="mb-1 text-center font-bold text-3xl">
          Create a project
        </h1>
        <p className="mb-6 text-center text-muted-foreground">
          Create your first project to continue
        </p>
        <div className="flex flex-col gap-4">
          <form.AppField name="name">
            {(field) => <field.TextField label="Name" type="text" />}
          </form.AppField>
          <form.AppForm>
            <form.SubmitButton className="w-full" size="lg">
              Create project
            </form.SubmitButton>
          </form.AppForm>
        </div>
      </form>
    </div>
  );
}
