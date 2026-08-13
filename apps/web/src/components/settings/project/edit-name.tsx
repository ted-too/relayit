import { useAppForm } from "@repo/ui/components/ui/custom/form";
import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  SettingsCard,
  SettingsCardContent,
  SettingsCardDescription,
  SettingsCardFooter,
  SettingsCardHeader,
  SettingsCardTitle,
} from "@/components/settings/card";
import { authClient } from "@/lib/auth-client";
import {
  type CreateProjectBody,
  createProjectBodySchema,
} from "@/lib/projects/schemas";
import { queries } from "@/lib/queries";

export function ProjectEditName() {
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const [{ data: me }, { data: organization }] = useSuspenseQueries({
    queries: [queries.session.me, queries.organizations.bySlug(orgSlug)],
  });
  const member = organization?.members.find(
    (member) => member.userId === me.user.id
  );
  const { mutateAsync } = useMutation({
    mutationFn: async (body: CreateProjectBody) => {
      const { data, error } = await authClient.organization.update({
        data: { name: body.name },
        organizationId: organization.id,
      });

      if (error) {
        return Promise.reject(error);
      }

      return data;
    },
    onSuccess: (data, __, ___, { client }) => {
      toast.success("Project name updated successfully");
      client.setQueryData(queries.organizations.bySlug(orgSlug).queryKey, {
        ...organization,
        name: data.name,
      });
      client.invalidateQueries({
        queryKey: queries.organizations.queryKey,
      });
    },
    onError: (error) => {
      toast.error("Failed to update project name", {
        description: error.message,
      });
    },
  });
  const form = useAppForm({
    defaultValues: {
      name: organization.name,
    } as CreateProjectBody,
    validators: {
      onSubmit: createProjectBodySchema,
    },
    onSubmit: async ({ value }) => await mutateAsync(value),
  });

  if (!member) {
    return null;
  }

  const canUpdate = authClient.organization.checkRolePermission({
    permissions: {
      organization: ["update"],
    },
    role: member.role,
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <SettingsCard>
        <SettingsCardHeader>
          <SettingsCardTitle>Project Name</SettingsCardTitle>
          <SettingsCardDescription>
            TODO: Add description of what this is for
          </SettingsCardDescription>
        </SettingsCardHeader>
        <SettingsCardContent>
          <form.AppField name="name">
            {(field) => (
              <field.TextField
                className={{ root: "max-w-xs", label: "sr-only" }}
                disabled={!canUpdate}
                label="Name"
                type="text"
              />
            )}
          </form.AppField>
        </SettingsCardContent>
        <SettingsCardFooter>
          <p>TODO: Add description of validation</p>
          <form.AppForm>
            <form.SubmitButton className="w-16" disabled={!canUpdate}>
              Save
            </form.SubmitButton>
          </form.AppForm>
        </SettingsCardFooter>
      </SettingsCard>
    </form>
  );
}
