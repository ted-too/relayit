import { createIntegrationSchema } from "@repo/shared/forms";
import {
  type GenericProviderConfig,
  generateDefaultFromSchema,
  type ProviderType,
} from "@repo/shared/providers";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@repo/ui/components/animate-ui/base/tooltip";
import { Button } from "@repo/ui/components/base/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/base/dialog";
import { formatFormErrors, useAppForm } from "@repo/ui/components/custom/form";
import { toast } from "@repo/ui/components/custom/sonner";
import { DynamicZodFormFields } from "@repo/ui/components/custom/zod-form";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Fragment, useMemo, useState } from "react";
import z from "zod";
import { useTRPC } from "@/integrations/trpc/react";

type CreateIntegrationFormProps = {
  type: ProviderType;
  submitWrapper?: typeof DialogFooter;
  config: GenericProviderConfig;
  onSuccess?: () => void;
  onError?: () => void;
};

export function CreateIntegrationForm({
  type,
  submitWrapper,
  config,
  onSuccess,
  onError,
}: CreateIntegrationFormProps) {
  const schema = createIntegrationSchema.extend(
    z.object({
      credentials: config.credentialsSchema,
    }).shape
  );

  const channels = useMemo(
    () =>
      Object.entries(config.channels).map(([channelType, channelConfig]) => ({
        value: channelType,
        label: `${channelConfig.label} (${channelType})`,
      })),
    [config.channels]
  );

  const defaultValues = useMemo(
    () =>
      ({
        provider: type,
        credentials: generateDefaultFromSchema(config.credentialsSchema),
        channels: channels.map((channel) => channel.value),
        priority: null,
        name: null,
        isDefault: false,
        isActive: true,
      }) as z.infer<typeof schema>,
    [config.credentialsSchema, channels, type]
  );

  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const { mutateAsync: createIntegration } = useMutation(
    trpc.integrations.create.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.integrations.list.queryOptions().queryKey,
        });
        toast.success("Integration created successfully");
        onSuccess?.();
      },
      onError: (error) => {
        toast.error("Failed to create integration", {
          description: error.message,
        });
        onError?.();
      },
    })
  );

  const form = useAppForm({
    defaultValues,
    validators: {
      // @ts-expect-error - FIXME: find a better way to handle this
      onSubmit: schema,
    },
    onSubmit: async ({ value }) => await createIntegration(value),
    onSubmitInvalid: ({ formApi }) => {
      const errorMessage = formatFormErrors(formApi.state.errors);
      toast.error("Form validation failed", {
        description: errorMessage,
      });
    },
  });

  const SubmitWrapper = submitWrapper ?? Fragment;

  return (
    <form
      className="grid w-full gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        form.handleSubmit();
      }}
    >
      <form.AppField name="name">
        {(field) => (
          <field.TextField
            description="A name for the integration (optional)"
            label="Name"
            placeholder={`e.g. ${config.label} Primary`}
          />
        )}
      </form.AppField>
      <form.AppField name="channels">
        {(field) => (
          <field.MultiSelectField
            description="At least one channel must be selected"
            disabled={channels.length === 1}
            items={channels}
            label="Channels"
          />
        )}
      </form.AppField>
      <div className="grid grid-cols-2 gap-4">
        <DynamicZodFormFields
          baseKey="credentials"
          defaultValues={defaultValues.credentials}
          form={form}
          schema={config.credentialsSchema}
        />
        <form.AppField name="priority">
          {(field) => (
            <field.TextField
              description="Lower priority = higher priority"
              label="Priority"
              min={0}
              placeholder="auto"
              type="number"
            />
          )}
        </form.AppField>
        <form.AppField name="isDefault">
          {(field) => (
            <field.SwitchField
              className={{
                input: "h-9 items-center",
              }}
              description="Always try this provider first"
              label="Is default"
              orientation="vertical"
            />
          )}
        </form.AppField>
        <form.AppField name="isActive">
          {(field) => (
            <field.SwitchField
              className={{
                input: "h-9 items-center",
              }}
              description="Whether this integration is active"
              label="Is active"
              orientation="vertical"
            />
          )}
        </form.AppField>
      </div>
      <SubmitWrapper className="col-span-full">
        <form.AppForm>
          <form.SubmitButton className="mt-4 w-full" size="lg">
            Configure
          </form.SubmitButton>
        </form.AppForm>
      </SubmitWrapper>
    </form>
  );
}

export function CreateIntegrationDialog({
  Icon,
  type,
  config,
}: {
  Icon: React.ComponentType<React.SVGProps<SVGSVGElement>>;
  type: ProviderType;
  config: CreateIntegrationFormProps["config"];
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <Tooltip>
        <DialogTrigger
          render={
            <TooltipTrigger
              render={
                <Button variant="secondary">
                  <Icon className="size-10" />
                </Button>
              }
            />
          }
        />
        <TooltipContent side="bottom">
          <p>{Object.keys(config.channels).join(", ")}</p>
        </TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Configure {config.label}</DialogTitle>
          <DialogDescription>
            Configure the integration to start sending messages.
          </DialogDescription>
        </DialogHeader>
        <CreateIntegrationForm
          config={config}
          onSuccess={() => setOpen(false)}
          submitWrapper={DialogFooter}
          type={type}
        />
      </DialogContent>
    </Dialog>
  );
}
