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
import { createCustomDomainFn } from "@/lib/domains/custom-domain.functions";
import {
  type CreateCustomDomainFormValues,
  createCustomDomainFormSchema,
} from "@/lib/domains/schemas";
import type { ProjectDomainListItem } from "@/lib/domains/types";
import { queries } from "@/lib/queries";

export function CreateDomain({
  render,
  children,
  open: _openProp,
  setOpen: _setOpenProp,
}: {
  render?: DialogTriggerProps["render"];
  children?: React.ReactNode;
  open?: boolean;
  setOpen?: (open: boolean) => void;
}) {
  const navigate = useNavigate();
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const [_open, _setOpen] = useState(false);
  const open = _openProp ?? _open;
  const setOpen = _setOpenProp ?? _setOpen;

  const { mutateAsync: createDomain } = useMutation({
    mutationFn: async (body: CreateCustomDomainFormValues) =>
      await createCustomDomainFn({
        data: {
          ...body,
          orgSlug,
        },
      }),
    onSuccess: async (data, _, __, { client }) => {
      client.setQueryData(
        queries.organizations.bySlug(orgSlug).listDomains.queryKey,
        (old: ProjectDomainListItem[] | undefined) => [
          ...(old ?? []).filter((domain) => domain.id !== data.id),
          data,
        ],
      );
      await client.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).listDomains.queryKey,
      });
      toast.success("Custom domain added successfully");
      form.reset();
      setOpen(false);
      navigate({
        to: "/$orgSlug/domains/$fqdn",
        params: { orgSlug, fqdn: data.fqdn },
      });
    },
    onError: (error: Error) => {
      toast.error("Failed to add custom domain", {
        description: error.message,
      });
    },
  });

  const form = useAppForm({
    defaultValues: {
      fqdn: "",
    } as CreateCustomDomainFormValues,
    validators: {
      // Transform on fqdn makes Zod input/output diverge from form values.
      onSubmit: createCustomDomainFormSchema as any,
    },
    onSubmit: async ({ value }) => {
      await createDomain({ fqdn: value.fqdn });
    },
  });

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          form.reset();
        }
        setOpen(nextOpen);
      }}
      open={open}
    >
      {children && <DialogTrigger render={render}>{children}</DialogTrigger>}
      <DialogPopup
        render={
          <form
            onSubmit={(e) => {
              e.preventDefault();
              form.handleSubmit();
            }}
          />
        }
      >
        <DialogHeader>
          <DialogTitle>Add Custom Domain</DialogTitle>
          <DialogDescription>
            Enter the domain you want to send email from. You'll verify ownership with DNS records
            after adding it.
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <FieldGroup>
            <form.AppField name="fqdn">
              {(field) => (
                <field.TextField
                  className={{ label: "sr-only" }}
                  label="Domain"
                  placeholder="example.com"
                  type="text"
                />
              )}
            </form.AppField>
          </FieldGroup>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <form.AppForm>
            <form.SubmitButton>Add Domain</form.SubmitButton>
          </form.AppForm>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
