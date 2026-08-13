/** biome-ignore-all lint/style/noNestedTernary: we need to nest ternaries here */
import { Badge } from "@repo/ui/components/reui/badge";
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
import { ScrollArea } from "@repo/ui/components/ui/coss/scroll-area";
import { Switch } from "@repo/ui/components/ui/coss/switch";
import { useAppForm } from "@repo/ui/components/ui/custom/form";
import {
  Field,
  FieldGroup,
  FieldLabel,
} from "@repo/ui/components/ui/shad/field";
import { type QueryClient, useMutation } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import {
  createApiKeyFn,
  updateApiKeyFn,
} from "@/lib/projects/api-key.functions";
import {
  type ApiKeyFormValues,
  apiKeyFormSchema,
} from "@/lib/projects/api-key-schemas";
import type { HydratedApiKey } from "@/lib/projects/api-keys";
import { queries } from "@/lib/queries";
import { FieldExpiresAt } from "./field-expires-at";

async function optimisticUpdate({
  client,
  data,
  orgSlug,
}: {
  client: QueryClient;
  data: HydratedApiKey;
  orgSlug: string;
}) {
  client.setQueryData(
    queries.organizations.bySlug(orgSlug).listApiKeys.queryKey,
    (old: HydratedApiKey[] | undefined) => [
      ...(old ?? []).filter((key) => key.id !== data.id),
      data,
    ]
  );
  await client.invalidateQueries({
    queryKey: queries.organizations.bySlug(orgSlug).listApiKeys.queryKey,
  });
}

export function UpsertApiKey({
  initialData,
  render,
  children,
  open: _openProp,
  setOpen: _setOpenProp,
}: {
  initialData?: HydratedApiKey;
  render?: DialogTriggerProps["render"];
  children?: React.ReactNode;
  open?: boolean;
  setOpen?: (open: boolean) => void;
}) {
  const [_open, _setOpen] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<string | undefined>(
    undefined
  );
  const open = _openProp ?? _open;
  const setOpen = _setOpenProp ?? _setOpen;
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });

  const { mutateAsync: upsertApiKey } = useMutation({
    mutationFn: async (body: ApiKeyFormValues) => {
      if (initialData) {
        return await updateApiKeyFn({
          data: {
            ...body,
            id: initialData.id,
            orgSlug,
          },
        });
      }

      return await createApiKeyFn({
        data: {
          ...body,
          orgSlug,
        },
      });
    },
    onSuccess: async (result, _, __, { client }) => {
      await optimisticUpdate({ client, data: result.data, orgSlug });
      toast.success(
        initialData
          ? "API key updated successfully"
          : "API key created successfully"
      );
      form.reset();
      const createdKey =
        "key" in result && typeof result.key === "string" ? result.key : null;
      if (createdKey) {
        setCreatedApiKey(createdKey);
      } else {
        setOpen(false);
      }
    },
    onError: (error: Error) => {
      toast.error("Failed to save API key", {
        description: error.message,
      });
    },
  });

  const form = useAppForm({
    defaultValues: {
      name: initialData?.name ?? "",
      expiresAt: initialData?.expiresAt?.toISOString() ?? undefined,
    } as ApiKeyFormValues,
    validators: {
      onSubmit: apiKeyFormSchema,
    },
    onSubmit: async ({ value }) => await upsertApiKey(value),
  });

  return (
    <Dialog
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          setCreatedApiKey(undefined);
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
            {initialData
              ? "Update API Key"
              : createdApiKey
                ? "Key Created"
                : "Create API Key"}
          </DialogTitle>
          <DialogDescription>
            {initialData
              ? "Update the name and expiration date of the API key"
              : createdApiKey
                ? "Please copy your new API key now. You will not be able to access it again."
                : "Choose a unique name that helps you identify the API key"}
          </DialogDescription>
        </DialogHeader>
        <DialogPanel>
          {createdApiKey ? (
            <ScrollArea className="w-full py-4">
              <Badge
                className="h-7"
                copyFirst
                copyText={createdApiKey}
                size="xl"
                variant="secondary"
              >
                {createdApiKey}
              </Badge>
            </ScrollArea>
          ) : (
            <FieldGroup>
              <form.AppField name="name">
                {(field) => (
                  <field.TextField
                    className={{ label: "sr-only" }}
                    label="Name"
                    placeholder="My test key"
                    type="text"
                  />
                )}
              </form.AppField>
              <form.Field name="expiresAt">
                {(field) => (
                  <div className="flex items-center gap-4">
                    <Field className="w-fit" orientation="horizontal">
                      <FieldLabel id={`${field.name}-enabled`}>
                        Expires
                      </FieldLabel>
                      <Switch
                        checked={field.state.value !== undefined}
                        id={`${field.name}-enabled`}
                        onCheckedChange={(checked) =>
                          field.handleChange(
                            checked
                              ? new Date(
                                  Date.now() + 30 * 24 * 60 * 60 * 1000
                                ).toISOString()
                              : undefined
                          )
                        }
                      />
                    </Field>
                    <FieldExpiresAt
                      className={{
                        label: "sr-only",
                      }}
                      errors={field.state.meta.errors}
                      label="Expires At"
                      name={field.name}
                      onChange={(date) => field.handleChange(date ?? undefined)}
                      value={field.state.value}
                    />
                  </div>
                )}
              </form.Field>
            </FieldGroup>
          )}
        </DialogPanel>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>
            Cancel
          </DialogClose>
          {createdApiKey ? (
            <DialogClose render={<Button variant="default" />}>
              I have copied my key
            </DialogClose>
          ) : (
            <form.AppForm>
              <form.SubmitButton>
                {initialData ? "Update" : "Create"}
              </form.SubmitButton>
            </form.AppForm>
          )}
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
