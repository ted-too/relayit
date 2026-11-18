import { type AdminProject, PauseDomainInput } from "@repo/contracts/dashboard";
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
} from "@repo/ui/components/ui/coss/dialog";
import { useAppForm } from "@repo/ui/components/ui/custom/form";
import { FieldGroup } from "@repo/ui/components/ui/shad/field";
import { type QueryClient, useMutation } from "@tanstack/react-query";
import { Schema } from "effect";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/confirm-action";
import { PAUSED_REASONS } from "@/components/settings/custom-domains/paused-reasons";
import { dashboard } from "@/lib/dashboard";
import { queries } from "@/lib/queries";

type AdminDomain = AdminProject["domains"][number];

/**
 * A platform admin pauses or unpauses a Domain, whichever its state calls for: a pause asks
 * for its reason, an unpause confirms. Either closes as the Domain's new state lands in the
 * admin's list, so its badge changes without a reload.
 */
export function DomainPause({
  domain,
  open,
  setOpen,
}: {
  domain: AdminDomain;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const params = { domainId: domain.id };
  const landed = async (
    client: QueryClient,
    state: Pick<AdminDomain, "isPaused" | "pausedReason">,
  ) => {
    // Closed in the same render as the state changes, or the other dialog would flash.
    setOpen(false);
    client.setQueryData(
      queries.admin.listProjects.queryKey,
      (old: readonly AdminProject[] | undefined) =>
        (old ?? []).map((project) => ({
          ...project,
          domains: project.domains.map((existing) =>
            existing.id === domain.id ? { ...existing, ...state } : existing,
          ),
        })),
    );
    toast.success(state.isPaused ? "Domain paused" : "Domain unpaused");
    // An admin who is also a member has the Project's own view of the Domain cached too.
    await Promise.all([
      client.invalidateQueries({ queryKey: queries.admin.listProjects.queryKey }),
      client.invalidateQueries({ queryKey: queries.organizations.queryKey }),
    ]);
  };

  const { mutateAsync: pauseDomain } = useMutation({
    mutationFn: async (payload: typeof PauseDomainInput.Type) =>
      await dashboard((client) => client.admin.pauseDomain({ params, payload })),
    onSuccess: (_, { reason }, __, { client }) =>
      landed(client, { isPaused: true, pausedReason: reason }),
    onError: (error: Error) => {
      toast.error("Failed to pause domain", { description: error.message });
    },
  });

  const { mutateAsync: unpauseDomain, isPending: isUnpausing } = useMutation({
    mutationFn: async () => await dashboard((client) => client.admin.unpauseDomain({ params })),
    onSuccess: (_, __, ___, { client }) => landed(client, { isPaused: false, pausedReason: null }),
    onError: (error: Error) => {
      toast.error("Failed to unpause domain", { description: error.message });
    },
  });

  const form = useAppForm({
    defaultValues: { reason: "manual_admin_pause" } as typeof PauseDomainInput.Encoded,
    validators: {
      onSubmit: Schema.toStandardSchemaV1(PauseDomainInput),
    },
    onSubmit: async ({ value }) => {
      // A failure has been shown by the mutation's `onError`, and leaves the dialog open to
      // try again; rethrown from here it would be nobody's to catch.
      await pauseDomain(value).then(
        () => form.reset(),
        () => undefined,
      );
    },
  });

  return (
    <>
      <Dialog
        onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            form.reset();
          }
          setOpen(nextOpen);
        }}
        open={open && !domain.isPaused}
      >
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
            <DialogTitle>Pause {domain.fqdn}</DialogTitle>
            <DialogDescription>
              While it is paused, new sends from this Domain are rejected and Deliveries already
              queued from it fail. Nothing is held to send later. Its Project's members see the
              pause and its reason, and cannot lift it: it stays paused until an admin unpauses it.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <FieldGroup>
              <form.AppField name="reason">
                {(field) => (
                  <field.SelectField
                    description="Shown to the Project's members while the Domain is paused."
                    items={PauseDomainInput.fields.reason.literals.map((reason) => ({
                      label: PAUSED_REASONS[reason].label,
                      value: reason,
                    }))}
                    label="Reason"
                  />
                )}
              </form.AppField>
            </FieldGroup>
          </DialogPanel>
          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <form.AppForm>
              <form.SubmitButton hasDefaults variant="destructive">
                Pause Domain
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <ConfirmAction
        confirm={{ text: "Unpause Domain", variant: "default" }}
        description={
          domain.pausedReason === "bad_reputation"
            ? "This Domain was paused for its Project's sending reputation, by an admin or by Relayit itself when SES paused the Project's sending. Unpausing it here does not restore that: check the Project's tenant in SES and restore its sending there first, or the next send is accepted, fails for good and pauses the Domain again."
            : "Sends from this Domain are accepted and delivered again straight away."
        }
        // The mutation closes it on success and toasts on failure, which leaves it open.
        execute={() => unpauseDomain().then(() => undefined)}
        isLoading={isUnpausing}
        onError={() => undefined}
        open={open && domain.isPaused}
        setOpen={setOpen}
        title={`Unpause ${domain.fqdn}`}
      />
    </>
  );
}
