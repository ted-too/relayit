import {
  type CreateOrganizationRequest,
  createOrganizationSchema,
} from "@repo/shared/forms";
import { useAppForm } from "@repo/ui/components/custom/form";
import { toast } from "@repo/ui/components/custom/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useTRPC } from "@/integrations/trpc/react";

export const Route = createFileRoute("/_authd/auth/finish")({
  beforeLoad: async ({ context }) => {
    const defaultOrganization = context.userOrganizations?.[0];

    if (context.session.activeOrganization) {
      throw redirect({
        to: "/$projectSlug",
        params: { projectSlug: context.session.activeOrganization.slug },
      });
    }

    if (defaultOrganization) {
      await context.auth.organization.setActive({
        organizationId: defaultOrganization.id,
        organizationSlug: defaultOrganization.slug,
      });
      await context.queryClient.invalidateQueries(
        context.trpc.auth.getSession.queryOptions()
      );
      throw redirect({
        to: "/$projectSlug",
        params: { projectSlug: defaultOrganization.slug },
      });
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const trpc = useTRPC();
  const navigate = useNavigate();

  const queryClient = useQueryClient();
  const { mutateAsync: createProject } = useMutation(
    trpc.project.create.mutationOptions({
      onSuccess: async ({ slug }) => {
        toast.success("Project created successfully");
        await queryClient.invalidateQueries(
          trpc.auth.getSession.queryOptions()
        );
        navigate({
          to: "/$projectSlug",
          params: { projectSlug: slug },
          reloadDocument: true,
        });
      },
      onError: (error) => {
        toast.error("Failed to create project", {
          description: error.message,
        });
      },
    })
  );

  const form = useAppForm({
    defaultValues: {
      name: "",
    } as CreateOrganizationRequest,
    validators: {
      onSubmit: createOrganizationSchema,
    },
    onSubmit: async ({ value }) => await createProject(value),
  });

  return (
    <div className="flex h-svh w-full items-center justify-center">
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
