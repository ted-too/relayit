import { useAppForm } from "@repo/ui/components/ui/custom/form";
import { InputGroupText } from "@repo/ui/components/ui/shad/input-group";
import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { toast } from "sonner";
import { ProjectSlug } from "@repo/contracts/dashboard";
import { Schema } from "effect";
import {
  SettingsCard,
  SettingsCardContent,
  SettingsCardDescription,
  SettingsCardFooter,
  SettingsCardHeader,
  SettingsCardTitle,
} from "@/components/settings/card";
import { authClient } from "@/lib/auth-client";
import { queries } from "@/lib/queries";

// better-auth sets the slug, and refuses one `ProjectSlug` doesn't take as well.
const SlugInput = Schema.Struct({ slug: ProjectSlug });

type FormSchema = typeof SlugInput.Type;

export function ProjectEditSlug() {
  const navigate = useNavigate();
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const [{ data: me }, { data: organization }] = useSuspenseQueries({
    queries: [queries.session.me, queries.organizations.bySlug(orgSlug)],
  });
  const member = organization?.members.find((member) => member.userId === me.user.id);
  const { mutateAsync } = useMutation({
    mutationFn: async (body: FormSchema) => {
      const { data, error } = await authClient.organization.update({
        data: { slug: body.slug },
        organizationId: organization.id,
      });

      if (error) {
        return Promise.reject(error);
      }

      return data;
    },
    onSuccess: (data, __, ___, { client }) => {
      toast.success("Project URL updated successfully");
      client.setQueryData(queries.organizations.bySlug(orgSlug).queryKey, {
        ...organization,
        slug: data.slug,
      });
      client.invalidateQueries({
        queryKey: queries.organizations.queryKey,
      });
      navigate({
        to: "/$orgSlug/project",
        params: { orgSlug: data.slug },
      });
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });
  const form = useAppForm({
    defaultValues: {
      slug: organization.slug,
    } as FormSchema,
    validators: {
      onSubmit: Schema.toStandardSchemaV1(SlugInput),
    },
    onSubmit: async ({ value }) => await mutateAsync(value),
  });

  if (!member) {
    return null;
  }

  const baseUrl = window.location.host;

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
          <SettingsCardTitle>Project URL</SettingsCardTitle>
          <SettingsCardDescription>
            TODO: Add description of what this is for
          </SettingsCardDescription>
        </SettingsCardHeader>
        <SettingsCardContent>
          <form.AppField name="slug">
            {(field) => (
              <field.TextField
                className={{
                  root: "max-w-xs",
                  label: "sr-only",
                  leftAddon: "border-r bg-muted pr-2",
                }}
                disabled={!canUpdate}
                hideError
                label="URL"
                leftAddon={
                  <InputGroupText className="text-muted-foreground">{baseUrl}/</InputGroupText>
                }
                type="text"
              />
            )}
          </form.AppField>
        </SettingsCardContent>
        <SettingsCardFooter>
          <form.AppField name="slug">
            {(field) => (
              <field.ErrorMessage
                className="text-sm"
                fallback={<p>Lowercase letters, digits and single hyphens, 2 to 48 characters.</p>}
              />
            )}
          </form.AppField>
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
