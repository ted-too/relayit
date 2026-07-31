import {
  CLIENT_PROVIDER_REGISTRY,
  type ProductKey,
} from "@repo/api/providers/client";
import {
  createAdminProviderBodySchema,
  updateAdminProviderBodySchema,
} from "@repo/api/validators/routes/admin/providers";
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
import { Separator } from "@repo/ui/components/ui/coss/separator";
import { Switch } from "@repo/ui/components/ui/coss/switch";
import { useAppForm } from "@repo/ui/components/ui/custom/form";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@repo/ui/components/ui/shad/field";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/ui/components/ui/shad/select";
import { generateDefaultFromSchema } from "@repo/ui/lib/zod-helpers";
import { useMutation } from "@tanstack/react-query";
import { useRouteContext } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import type * as z from "zod";
import { DynamicForm } from "@/components/dynamic-form";
import {
  type ApiClient,
  formatToastError,
  type InferData,
  type InferError,
} from "@/integrations/api";
import { queries } from "@/integrations/queries";
import { PROVIDER_ICONS } from "./icons";

const PRODUCTS = Object.values(CLIENT_PROVIDER_REGISTRY).flatMap((provider) =>
  Object.values(provider.products).map((product) => {
    const value = `${provider.id}.${product.id}` as ProductKey;
    return {
      label: `${provider.label} ${product.label}`,
      value,
      vendorId: provider.id,
      productId: product.id,
      config: product,
      Icon: PROVIDER_ICONS[value],
    };
  })
);

export function UpsertProvider({
  initialData,
  render,
  children,
  open: _openProp,
  setOpen: _setOpenProp,
}: {
  initialData?: InferData<ApiClient["admin"]["providers"]["get"]>[number];
  render?: DialogTriggerProps["render"];
  children?: React.ReactNode;
  open?: boolean;
  setOpen?: (open: boolean) => void;
}) {
  const { api } = useRouteContext({ from: "__root__" });
  const [_open, _setOpen] = useState(false);
  const open = _openProp ?? _open;
  const setOpen = _setOpenProp ?? _setOpen;
  const [productKey, setProductKey] = useState<ProductKey>(
    initialData
      ? (`${initialData.vendorId}.${initialData.productId}` as ProductKey)
      : PRODUCTS[0].value
  );
  const selectedProduct =
    PRODUCTS.find((product) => product.value === productKey) ?? PRODUCTS[0];
  const config = selectedProduct.config;
  const schema = (
    initialData ? updateAdminProviderBodySchema : createAdminProviderBodySchema
  ).extend({
    credentials: initialData
      ? config.credentialsSchema.optional()
      : config.credentialsSchema,
  });

  type FormValues = z.infer<typeof createAdminProviderBodySchema> & {
    credentials: z.infer<typeof config.credentialsSchema> | undefined;
  };

  const { mutateAsync: upsertProvider } = useMutation({
    mutationFn: async (body: FormValues) => {
      if (initialData) {
        const { data, error } = await api.admin
          .providers({ providerId: initialData.id })
          .patch(body as z.infer<typeof updateAdminProviderBodySchema>);

        if (error) {
          return Promise.reject(error);
        }

        return data;
      }

      const { data, error } = await api.admin.providers
        .byVendor({ vendorId: selectedProduct.vendorId })({
          productId: selectedProduct.productId,
        })
        .post(body as z.infer<typeof createAdminProviderBodySchema>);

      if (error) {
        return Promise.reject(error);
      }

      return data;
    },
    onSuccess: async (data, _, __, { client }) => {
      client.setQueryData(
        queries.admin.listProviders.queryKey,
        (old: InferData<ApiClient["admin"]["providers"]["get"]>) => [
          ...old.filter((provider) => provider.id !== data.id),
          data,
        ]
      );
      await client.invalidateQueries({
        queryKey: queries.admin.listProviders.queryKey,
      });
      toast.success(
        initialData
          ? "Provider updated successfully"
          : "Provider created successfully"
      );
      form.reset();
      setOpen(false);
    },
    onError: (
      error: InferError<
        ReturnType<
          ReturnType<ApiClient["admin"]["providers"]["byVendor"]>
        >["post"]
      >
    ) => {
      toast.error(...formatToastError(error));
    },
  });

  const form = useAppForm({
    defaultValues: {
      name: initialData?.name ?? null,
      isDefault: initialData?.isDefault ?? false,
      credentials: initialData?.credentials
        ? {
            unencrypted: initialData.credentials.unencrypted,
          }
        : generateDefaultFromSchema(config.credentialsSchema),
    } as FormValues,
    validators: {
      // biome-ignore lint/suspicious/noExplicitAny: zod schema union from create/update + product credentials
      onSubmit: schema as any,
    },
    onSubmit: async ({ value }) => await upsertProvider(value),
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
          <DialogTitle>
            {initialData ? "Update Provider" : "Create Provider"}
          </DialogTitle>
          <DialogDescription>
            {initialData
              ? "Update the name and credentials of the managed email backend"
              : "Add a managed email backend. The first one for a channel becomes the default; later ones can be marked default for Domain create when no provider is chosen."}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          <FieldGroup>
            <div className="grid grid-cols-2 gap-4">
              <form.AppField name="name">
                {(field) => (
                  <field.TextField
                    label="Name"
                    placeholder="My provider"
                    type="text"
                  />
                )}
              </form.AppField>
              <Field>
                <FieldLabel htmlFor="provider-config-id">Provider</FieldLabel>
                <Select
                  items={PRODUCTS}
                  onValueChange={(value) =>
                    setProductKey((value as ProductKey) ?? PRODUCTS[0].value)
                  }
                  value={productKey}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select a provider" />
                  </SelectTrigger>
                  <SelectContent alignItemWithTrigger={false}>
                    <SelectGroup>
                      {PRODUCTS.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <form.Field name="isDefault">
              {(field) => (
                <Field orientation="horizontal">
                  <FieldLabel htmlFor={field.name}>Default</FieldLabel>
                  <Switch
                    checked={Boolean(field.state.value)}
                    id={field.name}
                    onCheckedChange={(checked) => field.handleChange(checked)}
                  />
                </Field>
              )}
            </form.Field>
            <Separator orientation="horizontal" />
            <DynamicForm
              baseKey="credentials"
              // biome-ignore lint/suspicious/noExplicitAny: DynamicForm is intentionally untyped across product schemas
              form={form as any}
              schema={config.credentialsSchema}
            />
          </FieldGroup>
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          <form.AppForm>
            <form.SubmitButton>
              {initialData ? "Update" : "Create"}
            </form.SubmitButton>
          </form.AppForm>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
