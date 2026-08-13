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
import { useState } from "react";
import { toast } from "sonner";
import type * as z from "zod";
import { DynamicForm } from "@/components/dynamic-form";
import {
  createPlatformProviderFn,
  updatePlatformProviderFn,
} from "@/lib/admin/provider.functions";
import {
  DEFAULT_PLATFORM_PRODUCT,
  PLATFORM_EMAIL_PRODUCTS,
  type PlatformProductKey,
  platformProductByKey,
} from "@/lib/admin/provider-catalog";
import {
  createPlatformProviderBodySchema,
  updatePlatformProviderBodySchema,
} from "@/lib/admin/provider-schemas";
import type { PlatformProviderListItem } from "@/lib/admin/providers";
import { queries } from "@/lib/queries";
import { PROVIDER_ICONS } from "./icons";

const PRODUCTS = PLATFORM_EMAIL_PRODUCTS.map((product) => ({
  ...product,
  Icon: PROVIDER_ICONS[product.value],
}));

export function UpsertProvider({
  initialData,
  render,
  children,
  open: _openProp,
  setOpen: _setOpenProp,
}: {
  initialData?: PlatformProviderListItem;
  render?: DialogTriggerProps["render"];
  children?: React.ReactNode;
  open?: boolean;
  setOpen?: (open: boolean) => void;
}) {
  const [_open, _setOpen] = useState(false);
  const open = _openProp ?? _open;
  const setOpen = _setOpenProp ?? _setOpen;
  const [productKey, setProductKey] = useState<PlatformProductKey>(
    initialData
      ? (`${initialData.vendorId}.${initialData.productId}` as PlatformProductKey)
      : DEFAULT_PLATFORM_PRODUCT.value
  );
  const selectedProduct = platformProductByKey(productKey);
  const config = selectedProduct;
  const schema = (
    initialData
      ? updatePlatformProviderBodySchema.omit({ providerId: true })
      : createPlatformProviderBodySchema.omit({
          productId: true,
          vendorId: true,
        })
  ).extend({
    credentials: initialData
      ? config.credentialsSchema.partial().optional()
      : config.credentialsSchema,
  });

  interface FormValues {
    credentials: z.infer<typeof config.credentialsSchema> | undefined;
    isDefault?: boolean;
    name: string | null;
  }

  const { mutateAsync: upsertProvider } = useMutation({
    mutationFn: async (body: FormValues) => {
      if (initialData) {
        return await updatePlatformProviderFn({
          data: {
            ...body,
            providerId: initialData.id,
          },
        });
      }

      return await createPlatformProviderFn({
        data: {
          ...body,
          productId: selectedProduct.productId,
          vendorId: selectedProduct.vendorId,
          credentials: body.credentials as z.infer<
            typeof config.credentialsSchema
          >,
        },
      });
    },
    onSuccess: async (data: PlatformProviderListItem, _, __, { client }) => {
      client.setQueryData(
        queries.admin.listProviders.queryKey,
        (old: PlatformProviderListItem[] | undefined) => [
          ...(old ?? []).filter((provider) => provider.id !== data.id),
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
    onError: (error: Error) => {
      toast.error("Failed to save provider", {
        description: error.message,
      });
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
                  disabled={Boolean(initialData)}
                  items={PRODUCTS}
                  onValueChange={(value) =>
                    setProductKey(
                      (value as PlatformProductKey) ??
                        DEFAULT_PLATFORM_PRODUCT.value
                    )
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
