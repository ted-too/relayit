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

/** What an admin should know before lifting a pause that SES may put straight back. */
const UNPAUSE_WARNINGS: Partial<Record<NonNullable<AdminDomain["pausedReason"]>, string>> = {
  bad_reputation:
    "An admin paused this Domain for its Project's sending reputation, or Relayit did before its own pauses were recorded apart. Unpausing it does not restore the Project's sending in SES: if SES still pauses the Project's tenant, the next send is accepted, fails for good and pauses the Domain again.",
  project_sending_pause:
    "Relayit paused this Domain because SES paused its Project's sending, and unpauses it by itself when SES restores that. Restore the Project's tenant in SES instead of unpausing here: while SES still pauses it, the next send is accepted, fails for good and pauses the Domain again.",
};

/**
 * A platform admin pauses or unpauses a Domain: a pause asks for its reason, an unpause
 * confirms. A Domain that is already paused can be paused again, which only changes the
 * reason: that is how an admin keeps a Domain paused that Relayit paused itself and would
 * unpause when SES restores the Project, without unpausing it first. Either
 * closes as the Domain's new state lands in the admin's list, so its badge changes without
 * a reload.
 */
export function DomainPause({
  action,
  close,
  domain,
}: {
  action: "pause" | "unpause" | null;
  close: () => void;
  domain: AdminDomain;
}) {
  const params = { domainId: domain.id };
  const landed = async (
    client: QueryClient,
    state: Pick<AdminDomain, "isPaused" | "pausedReason">,
  ) => {
    close();
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
            close();
          }
        }}
        open={action === "pause"}
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
            <DialogTitle>
              {domain.isPaused ? `Keep ${domain.fqdn} paused` : `Pause ${domain.fqdn}`}
            </DialogTitle>
            <DialogDescription>
              {domain.isPaused
                ? "This Domain is paused already. Giving it a reason of your own makes the pause yours, without unpausing it: Relayit no longer unpauses it when SES restores the Project's sending. If Relayit has just unpaused it, this pauses it again. "
                : "While it is paused, new sends from this Domain are rejected and Deliveries already queued from it fail. Nothing is held to send later. "}
              Its Project's members see the pause and its reason, and cannot lift it: it stays
              paused until an admin unpauses it.
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
                {domain.isPaused ? "Keep Paused" : "Pause Domain"}
              </form.SubmitButton>
            </form.AppForm>
          </DialogFooter>
        </DialogPopup>
      </Dialog>
      <ConfirmAction
        confirm={{ text: "Unpause Domain", variant: "default" }}
        description={
          (domain.pausedReason && UNPAUSE_WARNINGS[domain.pausedReason]) ??
          "Sends from this Domain are accepted and delivered again straight away."
        }
        // The mutation closes it on success and toasts on failure, which leaves it open.
        execute={() => unpauseDomain().then(() => undefined)}
        isLoading={isUnpausing}
        onError={() => undefined}
        open={action === "unpause"}
        setOpen={(nextOpen) => {
          if (!nextOpen) {
            close();
          }
        }}
        title={`Unpause ${domain.fqdn}`}
      />
    </>
  );
}
