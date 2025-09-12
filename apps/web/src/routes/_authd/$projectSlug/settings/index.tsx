import {
  type UpdateOrganizationRequest,
  updateOrganizationSchema,
} from "@repo/shared/forms";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@repo/ui/components/base/card";
import { useAppForm } from "@repo/ui/components/custom/form";
import { toast } from "@repo/ui/components/custom/sonner";
import { useStore } from "@tanstack/react-form";
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute, useParams, useRouter } from "@tanstack/react-router";
import { useCallback } from "react";
import { useTRPC } from "@/integrations/trpc/react";

export const Route = createFileRoute("/_authd/$projectSlug/settings/")({
  component: RouteComponent,
});

function RouteComponent() {
  const trpc = useTRPC();
  const { projectSlug } = useParams({
    from: "/_authd/$projectSlug",
  });
  const {
    data: { session },
  } = useSuspenseQuery(trpc.auth.getSession.queryOptions());

  const { mutateAsync: checkSlug, isPending: isCheckingSlug } = useMutation(
    trpc.project.checkSlug.mutationOptions()
  );
  const queryClient = useQueryClient();
  const router = useRouter();
  const { mutateAsync: _generateSlug, isPending: isGeneratingSlug } =
    useMutation(trpc.project.generateSlug.mutationOptions());
  const { mutateAsync: updateProject } = useMutation(
    trpc.project.update.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries(
          trpc.auth.getSession.queryOptions()
        );
        await router.invalidate({ sync: true });
        toast.success("Project updated successfully");
      },
      onError: (error) => {
        toast.error("Failed to update project", {
          description: error.message,
        });
      },
    })
  );

  const form = useAppForm({
    defaultValues: {
      currentProjectSlug: projectSlug,
      name: session.activeOrganization?.name ?? null,
      logo: session.activeOrganization?.logo ?? null,
      slug: session.activeOrganization?.slug ?? null,
    } as UpdateOrganizationRequest,
    validators: {
      onSubmit: updateOrganizationSchema,
    },
    onSubmit: async ({ value }) => await updateProject(value),
  });

  const name = useStore(form.store, (state) => state.values.name);
  const generateSlug = useCallback(async () => {
    if (!name) return;
    const { slug } = await _generateSlug({ name });
    form.setFieldValue("slug", slug);
  }, [name, _generateSlug, form.setFieldValue]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <Card className="w-full">
        <CardHeader>
          <CardTitle className="text-2xl">Project details</CardTitle>
          <CardDescription>Manage your project details.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <form.AppField name="name">
            {(field) => <field.TextField label="Name" type="text" />}
          </form.AppField>
          <form.AppField
            name="slug"
            validators={{
              onChangeAsyncDebounceMs: 250,
              onChangeAsync: async ({ value }) => {
                if (!value || value === projectSlug) return;
                const { exists } = await checkSlug({ slug: value });
                if (exists) {
                  return "Slug already taken";
                }
              },
            }}
          >
            {(field) => (
              <field.SlugField
                label="Slug"
                isChecking={isCheckingSlug}
                isGenerating={isGeneratingSlug}
                generate={generateSlug}
              />
            )}
          </form.AppField>
          <form.AppField name="logo">
            {(field) => <field.TextField label="Logo URL" type="text" />}
          </form.AppField>
        </CardContent>
        <CardFooter>
          <form.AppForm>
            <form.SubmitButton className="ml-auto w-36">
              Update project
            </form.SubmitButton>
          </form.AppForm>
        </CardFooter>
      </Card>
    </form>
  );
}
