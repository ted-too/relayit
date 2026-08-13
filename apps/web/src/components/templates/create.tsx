import { Button } from "@repo/ui/components/ui/coss/button";
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
  DialogTrigger,
  type DialogTriggerProps,
} from "@repo/ui/components/ui/coss/dialog";
import { useAppForm } from "@repo/ui/components/ui/custom/form";
import { FieldGroup } from "@repo/ui/components/ui/shad/field";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { queries } from "@/lib/queries";
import type { TemplateListItem } from "@/lib/templating/catalog";
import {
  type CreateTemplateFormValues,
  createTemplateFormSchema,
} from "@/lib/templating/schemas";
import { createTemplateFn } from "@/lib/templating/template.functions";

export function CreateTemplate({
  render,
  children,
  open: openProp,
  setOpen: setOpenProp,
}: {
  render?: DialogTriggerProps["render"];
  children?: React.ReactNode;
  open?: boolean;
  setOpen?: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const [internalOpen, setInternalOpen] = useState(false);
  const open = openProp ?? internalOpen;
  const setOpen = setOpenProp ?? setInternalOpen;

  const { mutateAsync: createTemplate } = useMutation({
    mutationFn: async (body: CreateTemplateFormValues) =>
      await createTemplateFn({
        data: {
          ...body,
          orgSlug,
        },
      }),
    onSuccess: async (data, _, __, { client }) => {
      client.setQueryData(
        queries.organizations.bySlug(orgSlug).listTemplates.queryKey,
        (old: TemplateListItem[] | undefined) => [...(old ?? []), data]
      );
      await client.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).listTemplates.queryKey,
      });
      toast.success("Template created");
      form.reset();
      setOpen(false);
      void navigate({
        to: "/$orgSlug/automations/templates/$templateId",
        params: { orgSlug, templateId: data.id },
      });
    },
    onError: (error: Error) => {
      toast.error("Failed to create Template", {
        description: error.message,
      });
    },
  });

  const form = useAppForm({
    defaultValues: {
      name: "",
    } satisfies CreateTemplateFormValues,
    validators: {
      onSubmit: createTemplateFormSchema,
    },
    onSubmit: async ({ value }) => {
      await createTemplate(value);
    },
  });

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      {children ? (
        <DialogTrigger render={render}>{children}</DialogTrigger>
      ) : null}
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Create Template</DialogTitle>
          <DialogDescription>
            Name your Template. A unique slug is generated automatically for the
            send API.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <form
            className="flex flex-col gap-4"
            id="create-template-form"
            onSubmit={(event) => {
              event.preventDefault();
              void form.handleSubmit();
            }}
          >
            <FieldGroup>
              <form.AppField name="name">
                {(field) => (
                  <field.TextField
                    autoFocus
                    label="Name"
                    placeholder="Welcome email"
                  />
                )}
              </form.AppField>
            </FieldGroup>
          </form>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <form.AppForm>
            <form.SubmitButton form="create-template-form">
              Create
            </form.SubmitButton>
          </form.AppForm>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
