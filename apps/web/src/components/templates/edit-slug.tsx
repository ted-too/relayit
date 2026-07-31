import type { PatchTemplateBody } from "@repo/api/validators/routes/projects/templating/templates";
import { safeString } from "@repo/api/validators/shared";
import { Button } from "@repo/ui/components/ui/coss/button";
import { useAppForm } from "@repo/ui/components/ui/custom/form";
import { FieldGroup } from "@repo/ui/components/ui/shad/field";
import { useMutation } from "@tanstack/react-query";
import { useParams, useRouteContext } from "@tanstack/react-router";
import { toast } from "sonner";
import { z } from "zod";
import { formatToastError } from "@/integrations/api";
import { queries } from "@/integrations/queries";
import type { Template } from "./types";

const formSchema = z.object({
  slug: safeString.min(1).max(128),
});

type FormSchema = z.infer<typeof formSchema>;

export function TemplateEditSlug({ template }: { template: Template }) {
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const { api } = useRouteContext({ from: "__root__" });

  const { mutateAsync } = useMutation({
    mutationFn: async (body: PatchTemplateBody) => {
      const { data, error } = await api
        .projects({ orgSlug })
        .templating.templates({ id: template.id })
        .patch(body);

      if (error) {
        return Promise.reject(error);
      }

      return data;
    },
    onSuccess: async (data, _, __, { client }) => {
      client.setQueryData(
        queries.organizations.bySlug(orgSlug).template(template.id).queryKey,
        data
      );
      await client.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).listTemplates.queryKey,
      });
      toast.success("Template slug updated");
      form.reset({ slug: data.slug });
    },
    onError: (error) => {
      toast.error(...formatToastError(error as never));
    },
  });

  const form = useAppForm({
    defaultValues: {
      slug: template.slug,
    } as FormSchema,
    validators: {
      onSubmit: formSchema,
    },
    onSubmit: async ({ value }) => {
      if (value.slug === template.slug) {
        return;
      }
      await mutateAsync({ slug: value.slug });
    },
  });

  if (template.archivedAt) {
    return (
      <section className="flex flex-col gap-2 rounded-lg border bg-card p-6">
        <h2 className="font-medium text-lg">Slug</h2>
        <p className="font-mono text-sm">{template.slug}</p>
        <p className="text-muted-foreground text-sm">
          Archived Templates cannot be edited.
        </p>
      </section>
    );
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border bg-card p-6"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-lg">Slug</h2>
        <p className="text-muted-foreground text-sm">
          Stable send-path handle. Must be unique among active Templates in this
          Project. Changing it does not rename Workspace Entry files.
        </p>
      </div>
      <FieldGroup>
        <form.AppField name="slug">
          {(field) => (
            <field.TextField
              className={{ root: "max-w-md" }}
              label="Slug"
              placeholder="welcome-email"
              type="text"
            />
          )}
        </form.AppField>
      </FieldGroup>
      <div>
        <form.AppForm>
          <form.Subscribe
            selector={(state) =>
              state.values.slug === template.slug || state.isSubmitting
            }
          >
            {(disabled) => (
              <Button disabled={disabled} type="submit">
                Save slug
              </Button>
            )}
          </form.Subscribe>
        </form.AppForm>
      </div>
    </form>
  );
}
