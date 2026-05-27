import {
  type CreateOrganizationRequest,
  createOrganizationSchema,
} from "@repo/shared/forms";
import { useAppForm } from "@repo/ui/components/ui/custom/form";
import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import { useParams, useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  SettingsCard,
  SettingsCardContent,
  SettingsCardDescription,
  SettingsCardFooter,
  SettingsCardHeader,
  SettingsCardTitle,
} from "@/components/settings/card";
import { queries } from "@/integrations/queries";

export function ProjectEditName() {
  const { betterAuth } = useRouteContext({ from: "/_authd/$orgSlug" });
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const [{ data: me }, { data: organization }] = useSuspenseQueries({
    queries: [
      queries.session.me,
      queries.session.me.organizations.bySlug(orgSlug),
    ],
  });
  const member = organization?.members.find(
    (member) => member.userId === me.user.id
  );
  const { mutateAsync } = useMutation({
    mutationFn: async (body: CreateOrganizationRequest) => {
      const { data, error } = await betterAuth.organization.update({
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
      client.setQueryData(
        queries.session.me.organizations.bySlug(orgSlug).queryKey,
        { ...organization, name: data.name }
      );
      client.invalidateQueries({
        queryKey: queries.session.me.organizations.queryKey,
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
    } as CreateOrganizationRequest,
    validators: {
      onSubmit: createOrganizationSchema,
    },
    onSubmit: async ({ value }) => await mutateAsync(value),
  });

  if (!member) {
    return null;
  }

  const canUpdate = betterAuth.organization.checkRolePermission({
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
