import { createDomainBodySchema } from "@repo/api/validators/routes/projects/channels/email/domains";
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
import {
  useNavigate,
  useParams,
  useRouteContext,
} from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import type * as z from "zod";
import {
  type ApiClient,
  formatToastError,
  type InferError,
} from "@/integrations/api";
import { queries } from "@/integrations/queries";
import type { Domain } from "./types";

type CreateDomainBody = z.infer<typeof createDomainBodySchema>;

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
  const { api } = useRouteContext({ from: "__root__" });
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
    mutationFn: async (body: CreateDomainBody) => {
      const { data, error } = await api
        .projects({ orgSlug })
        .channels.email.domains.post(body);

      if (error) {
        return Promise.reject(error);
      }

      return data;
    },
    onSuccess: async (data, _, __, { client }) => {
      client.setQueryData(
        queries.organizations.bySlug(orgSlug).listDomains.queryKey,
        (old: Domain[]) => [...old, data]
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
    onError: (
      error: InferError<
        ReturnType<
          ApiClient["projects"]
        >["channels"]["email"]["domains"]["post"]
      >
    ) => {
      toast.error(...formatToastError(error));
    },
  });

  const form = useAppForm({
    defaultValues: {
      fqdn: "",
      providerId: defaultProviderId,
    } satisfies CreateDomainBody,
    validators: {
      // Transform on fqdn makes Zod input/output diverge from form values.
      // biome-ignore lint/suspicious/noExplicitAny: see above
      onSubmit: createDomainBodySchema as any,
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

      // Single (or zero) managed backend — let the API resolve the default.
      await createDomain({ fqdn: value.fqdn });
    },
  });

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          form.reset();
        }
        setOpen(open);
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
