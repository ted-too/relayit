import type { SanitizedProviderCredential } from "@repo/shared/db/types";
import { createIdentitySchema } from "@repo/shared/forms";
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
import {
  useMutation,
  useQueryClient,
  useSuspenseQuery,
} from "@tanstack/react-query";
import { PlusIcon } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import type z from "zod";
import { useTRPC } from "@/integrations/trpc/react";

type CreateIdentityFormProps = {
  providerCredential: SanitizedProviderCredential;
  submitWrapper?: typeof DialogFooter;
  onSuccess?: () => void;
  onError?: () => void;
};

export function CreateIdentityForm({
  providerCredential,
  submitWrapper,
  onSuccess,
  onError,
}: CreateIdentityFormProps) {
  const schema = createIdentitySchema;
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const {
    data: { session },
  } = useSuspenseQuery(trpc.auth.getSession.queryOptions());

  const isEmailProvider = providerCredential.channelType === "email";
  const orgName = session.activeOrganization?.name;

  const defaultValues = useMemo(
    () =>
      ({
        providerCredentialId: providerCredential.id,
        identifier: "",
        channelData:
          isEmailProvider && orgName
            ? {
                email: {
                  name: orgName,
                },
              }
            : {},
        isDefault: false,
        isActive: true,
      }) as z.infer<typeof schema>,
    [providerCredential.id, isEmailProvider, orgName]
  );

  const { mutateAsync: createIdentity } = useMutation(
    trpc.identities.create.mutationOptions({
      onSuccess: async () => {
        await queryClient.invalidateQueries({
          queryKey: trpc.identities.list.queryOptions({
            providerCredentialId: providerCredential.id,
          }).queryKey,
        });
        toast.success("Identity created successfully");
        onSuccess?.();
      },
      onError: (error) => {
        toast.error("Failed to create identity", {
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
    onSubmit: async ({ value }) => await createIdentity(value),
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
      <form.AppField name="identifier">
        {(field) => (
          <field.TextField
            description="The from address or identity for this provider"
            label="Identity"
            placeholder="e.g. noreply@example.com"
          />
        )}
      </form.AppField>
      {isEmailProvider && (
        <form.AppField name="channelData.email.name">
          {(field) => (
            <field.TextField
              description="The name that will appear in the 'From' field of emails"
              label="Display Name"
              placeholder="e.g. Your Company Name"
            />
          )}
        </form.AppField>
      )}
      <div className="grid grid-cols-2 gap-4">
        <form.AppField name="isDefault">
          {(field) => (
            <field.SwitchField
              className={{
                input: "h-9 items-center",
              }}
              description="Use this identity as the default for this provider"
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
              description="Whether this identity is active"
              label="Is active"
              orientation="vertical"
            />
          )}
        </form.AppField>
      </div>
      <SubmitWrapper className="col-span-full">
        <form.AppForm>
          <form.SubmitButton className="mt-4 w-full" size="lg">
            Create Identity
          </form.SubmitButton>
        </form.AppForm>
      </SubmitWrapper>
    </form>
  );
}

export function CreateIdentityDialog({
  providerCredential,
}: {
  providerCredential: SanitizedProviderCredential;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <Tooltip>
        <DialogTrigger
          render={
            <TooltipTrigger
              render={
                <Button size="sm" variant="secondary">
                  <PlusIcon className="size-3" /> Add Identity
                </Button>
              }
            />
          }
        />
        <TooltipContent side="bottom">
          <p>Add a new identity for this provider</p>
        </TooltipContent>
      </Tooltip>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Identity</DialogTitle>
          <DialogDescription>
            Add a new identity (from address) for this provider integration.
          </DialogDescription>
        </DialogHeader>
        <CreateIdentityForm
          onSuccess={() => setOpen(false)}
          providerCredential={providerCredential}
          submitWrapper={DialogFooter}
        />
      </DialogContent>
    </Dialog>
  );
}
