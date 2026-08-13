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
import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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

  const {
    data: { managed, byo, defaultManagedProviderId },
  } = useSuspenseQuery(queries.organizations.bySlug(orgSlug).listProviders);

  const showProviderPicker = managed.length > 1 || byo.length > 0;

  const providerItems = useMemo(() => {
    const items: { label: string; value: string }[] = [];

    for (const provider of managed) {
      items.push({
        label: `${provider.name ?? `${provider.vendorId}.${provider.productId}`}${provider.isDefault ? " · default" : ""}`,
        value: provider.id,
      });
    }

    for (const provider of byo) {
      items.push({
        label: `${provider.name ?? `${provider.vendorId}.${provider.productId}`} · BYO`,
        value: provider.id,
      });
    }

    return items;
  }, [managed, byo]);

  const defaultProviderId =
    defaultManagedProviderId ??
    managed.find((provider) => provider.isDefault)?.id ??
    managed[0]?.id ??
    byo[0]?.id;

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
        ]
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
      providerId: defaultProviderId,
    } as CreateCustomDomainFormValues,
    validators: {
      // Transform on fqdn makes Zod input/output diverge from form values.
      // biome-ignore lint/suspicious/noExplicitAny: see above
      onSubmit: createCustomDomainFormSchema as any,
    },
    onSubmit: async ({ value }) => {
      if (showProviderPicker) {
        if (!value.providerId) {
          toast.error("Select an email provider");
          return;
        }
        await createDomain({
          fqdn: value.fqdn,
          providerId: value.providerId,
        });
        return;
      }

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
            Enter the domain you want to send email from. You'll verify
            ownership with DNS records after adding it.
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
            {showProviderPicker && (
              <form.AppField name="providerId">
                {(field) => (
                  <field.SelectField
                    items={providerItems}
                    label="Email provider"
                  />
                )}
              </form.AppField>
            )}
          </FieldGroup>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <form.AppForm>
            <form.SubmitButton>Add Domain</form.SubmitButton>
          </form.AppForm>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
