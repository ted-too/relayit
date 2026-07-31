import { RiArrowLeftSLine, RiMore2Line } from "@remixicon/react";
import {
  type CreateProjectBody,
  createProjectBodySchema,
} from "@repo/api/validators/routes/projects/project";
import { Button } from "@repo/ui/components/ui/coss/button";
import { useAppForm } from "@repo/ui/components/ui/custom/form";
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { NavUser } from "@/components/layout/nav-user";
import { formatToastError, type InferError } from "@/integrations/api";
import { queries } from "@/integrations/queries";

// FIXME: We need to ensure slugs on the api don't collide with this page

export const Route = createFileRoute("/_authd/create-project")({
  loader: ({ context }) => {
    void context.queryClient.prefetchQuery(queries.session.me);
    void context.queryClient.prefetchQuery(queries.organizations.list);
  },
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = Route.useNavigate();
  const { api } = Route.useRouteContext();
  const { data: organizations } = useSuspenseQuery(queries.organizations.list);

  const { mutateAsync } = useMutation({
    mutationFn: async (body: CreateProjectBody) => {
      const { data, error } = await api.projects.post(body);

      if (error) {
        return Promise.reject(error);
      }

      return data;
    },
    onSuccess: (data, _, __, { client }) => {
      toast.success("Project created successfully");
      client.setQueryData(
        queries.organizations.bySlug(data.slug).queryKey,
        data
      );
      client.invalidateQueries({
        queryKey: queries.organizations.queryKey,
      });
      // TODO: Redirect to onboarding page of org
      navigate({ to: "/$orgSlug", params: { orgSlug: data.slug } });
    },
    onError: (error: InferError<typeof api.projects.post>) => {
      toast.error(...formatToastError(error));
    },
  });

  const form = useAppForm({
    defaultValues: {
      name: "",
    } as CreateProjectBody,
    validators: {
      onSubmit: createProjectBodySchema,
    },
    onSubmit: async ({ value }) => await mutateAsync(value),
  });

  return (
    <div className="flex h-svh w-full flex-col items-center justify-between px-4">
      <form
        className="mt-[20svh] flex w-full max-w-sm flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          form.handleSubmit();
        }}
      >
        <h1 className="mb-1 text-center font-bold text-3xl">Create Project</h1>
        <p className="mb-6 text-center text-muted-foreground">
          TODO: Describe what it is and why you need it
        </p>
        <div className="flex flex-col gap-4">
          <form.AppField name="name">
            {(field) => <field.TextField label="Name" type="text" />}
          </form.AppField>
          <form.AppForm>
            <form.SubmitButton className="w-full" size="lg">
              Create Project
            </form.SubmitButton>
          </form.AppForm>
          {organizations.length >= 1 && (
            <Button render={<Link to="/" />} variant="link">
              <RiArrowLeftSLine />
              Select an existing project
            </Button>
          )}
        </div>
      </form>
      <div className="mb-[10svh] flex w-full max-w-xs flex-col items-center gap-2">
        <NavUser
          hideDetails
          render={
            <Button
              className="h-13 w-full gap-2 p-2! text-sm! sm:h-13"
              size="xl"
              variant="outline"
            />
          }
          side="top"
          triggerIcon={<RiMore2Line className="ml-auto size-4" />}
        />
      </div>
    </div>
  );
}
