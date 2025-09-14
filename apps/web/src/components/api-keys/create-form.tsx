import {
  type CreateApiKeyRequest,
  createApiKeySchema,
} from "@repo/shared/forms";
import { Button, type ButtonProps } from "@repo/ui/components/base/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@repo/ui/components/base/dialog";
import { Skeleton } from "@repo/ui/components/base/skeleton";
import { useAppForm } from "@repo/ui/components/custom/form";
import {
  Snippet,
  SnippetCopyButton,
  SnippetHeader,
  SnippetTabsContent,
  SnippetTabsList,
  SnippetTabsPanels,
  SnippetTabsTrigger,
} from "@repo/ui/components/custom/snippet";
import { toast } from "@repo/ui/components/custom/sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { KeyRound, PlusIcon } from "lucide-react";
import { Fragment, useState } from "react";
import { useTRPC } from "@/integrations/trpc/react";

type CreateApiKeyFormProps = {
  submitWrapper?: typeof DialogFooter;
};

export function CreateApiKeyForm({ submitWrapper }: CreateApiKeyFormProps) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const [createdApiKey, setCreatedApiKey] = useState<string | null>(null);
  const { mutateAsync: createApiKey } = useMutation(
    trpc.auth.createApiKey.mutationOptions({
      onSuccess: async ({ key }) => {
        await queryClient.invalidateQueries({
          queryKey: trpc.auth.listApiKeys.queryOptions().queryKey,
        });
        setCreatedApiKey(key);
        toast.success("API key created successfully");
      },
      onError: (error) => {
        toast.error("Failed to create API key", {
          description: error.message,
        });
      },
    })
  );

  const form = useAppForm({
    defaultValues: {
      name: "",
      expiresIn: undefined,
    } as CreateApiKeyRequest,
    validators: {
      onSubmit: createApiKeySchema,
    },
    onSubmit: async ({ value }) => await createApiKey(value),
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
            description="Make sure to copy your API key now. For security reasons, we don't
						store the full key and you won't be able to see it again."
            label="Key Name"
            placeholder="e.g., 2labs"
            disabled={createdApiKey !== null}
          />
        )}
      </form.AppField>

      {form.state.isSubmitting && !createdApiKey && (
        <Skeleton className="h-10 w-full" />
      )}

      {createdApiKey && (
        <Snippet value="api-key">
          <SnippetHeader>
            <SnippetTabsList>
              <SnippetTabsTrigger value="api-key">
                <KeyRound size={14} />
                <span>API Key</span>
              </SnippetTabsTrigger>
            </SnippetTabsList>
            <SnippetCopyButton
              onCopy={() => toast.success("Copied to clipboard")}
              onError={() => toast.error("Failed to copy to clipboard")}
              value={createdApiKey}
            />
          </SnippetHeader>
          <SnippetTabsPanels>
            <SnippetTabsContent value="api-key">
              {createdApiKey}
            </SnippetTabsContent>
          </SnippetTabsPanels>
        </Snippet>
      )}

      <SubmitWrapper className="col-span-full">
        <form.AppForm>
          {submitWrapper ? (
            createdApiKey !== null ? (
              <DialogClose
                render={
                  <Button className="mt-4 w-full" size="lg" type="button">
                    Done
                  </Button>
                }
              />
            ) : (
              <form.SubmitButton className="mt-4 w-full" size="lg">
                Create
              </form.SubmitButton>
            )
          ) : (
            <form.SubmitButton
              className="mt-4 w-full"
              disabled={!!createdApiKey}
              size="lg"
            >
              Create
            </form.SubmitButton>
          )}
        </form.AppForm>
      </SubmitWrapper>
    </form>
  );
}

export function CreateApiKeyDialog({
  button = {
    label: "Create",
    variant: "default",
    size: "default",
  },
  children,
}: {
  button?: {
    label: string;
    variant?: ButtonProps["variant"];
    size?: ButtonProps["size"];
    className?: string;
  };
  children?: React.ReactNode;
}) {
  return (
    <Dialog>
      <DialogTrigger
        render={
          (children as any) ?? (
            <Button
              className={button.className}
              size={button.size}
              variant={button.variant}
            >
              <PlusIcon />
              {button.label}
            </Button>
          )
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create API Key</DialogTitle>
          <DialogDescription>
            Give your API key a name to help you identify it later
          </DialogDescription>
        </DialogHeader>
        <CreateApiKeyForm submitWrapper={DialogFooter} />
      </DialogContent>
    </Dialog>
  );
}
