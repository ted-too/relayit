import {
  RiDeleteBin6Line,
  RiEyeLine,
  RiPauseCircleLine,
  RiPlayCircleLine,
  RiRefreshLine,
} from "@remixicon/react";
import { PauseDomainInput } from "@repo/contracts/dashboard";
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
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "@repo/ui/components/ui/coss/menu";
import { useAppForm } from "@repo/ui/components/ui/custom/form";
import { FieldGroup } from "@repo/ui/components/ui/shad/field";
import { useMutation, useSuspenseQueries } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { Schema } from "effect";
import { type ComponentProps, useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/confirm-action";
import { authClient } from "@/lib/auth-client";
import { dashboard } from "@/lib/dashboard";
import { queries } from "@/lib/queries";
import type { Domain } from "./types";

export function useRefreshDomain({ domain }: { domain: Domain }) {
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });

  return useMutation({
    mutationFn: async () =>
      await dashboard((client) =>
        client.domains.refresh({ params: { domainId: domain.id, orgSlug } }),
      ),
    onSuccess: async (data, _, __, { client }) => {
      client.setQueryData(
        queries.organizations.bySlug(orgSlug).listDomains.queryKey,
        (old: readonly Domain[] | undefined) =>
          (old ?? []).map((existingDomain) =>
            existingDomain.id === data.id ? data : existingDomain,
          ),
      );
      await client.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).listDomains.queryKey,
      });
      toast.success("Domain verification refreshed");
    },
    onError: (error: Error) => {
      toast.error("Failed to refresh domain", {
        description: error.message,
      });
    },
  });
}

export function useDeleteDomain({ domain, onDeleted }: { domain: Domain; onDeleted?: () => void }) {
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });

  return useMutation({
    mutationFn: async () =>
      await dashboard((client) =>
        client.domains.delete({ params: { domainId: domain.id, orgSlug } }),
      ),
    onSuccess: (_, __, ___, { client }) => {
      onDeleted?.();
      client.setQueryData(
        queries.organizations.bySlug(orgSlug).listDomains.queryKey,
        (old: readonly Domain[] | undefined) =>
          (old ?? []).filter((existingDomain) => existingDomain.id !== domain.id),
      );
      client.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).listDomains.queryKey,
      });
    },
    onError: (error: Error) => {
      toast.error("Failed to delete custom domain", {
        description: error.message,
      });
    },
  });
}

/** Why a Domain is paused, as the dashboard says it. */
export const PAUSED_REASONS = {
  bad_reputation: {
    description: "It was paused for its sending reputation: too many bounces or complaints.",
    label: "Bad reputation",
  },
  manual_admin_pause: {
    description: "A member of this Project paused it by hand.",
    label: "Manual pause",
  },
} as const satisfies Record<
  typeof PauseDomainInput.Type.reason,
  { description: string; label: string }
>;

/**
 * Whether the signed-in member may pause or unpause this Domain: their role has the
 * `domain: update` the api's routes require, and the Project holds the Domain rather than
 * claiming it. The api refuses the rest; this only keeps the action off their screen.
 */
export function useCanPauseDomain({ domain }: { domain: Domain }) {
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const [{ data: me }, { data: organization }] = useSuspenseQueries({
    queries: [queries.session.me, queries.organizations.bySlug(orgSlug)],
  });
  const member = organization.members.find((member) => member.userId === me.user.id);

  return (
    domain.ownership.status === "active" &&
    member !== undefined &&
    authClient.organization.checkRolePermission({
      permissions: { domain: ["update"] },
      role: member.role,
    })
  );
}

/**
 * Pauses or unpauses a Domain, whichever its state calls for: a pause asks for its reason,
 * an unpause confirms. Either closes as the Domain's new state lands in the list, so the
 * badge and banner change without a reload.
 */
export function DomainPause({
  domain,
  open,
  setOpen,
}: {
  domain: Domain;
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const params = { domainId: domain.id, orgSlug };
  const domains = queries.organizations.bySlug(orgSlug).listDomains.queryKey;

  const { mutateAsync: pauseDomain } = useMutation({
    mutationFn: async (payload: typeof PauseDomainInput.Type) =>
      await dashboard((client) => client.domains.pause({ params, payload })),
    onSuccess: async (_, { reason }, __, { client }) => {
      // Closed in the same render as the state changes, or the unpause dialog would flash.
      setOpen(false);
      client.setQueryData(domains, (old: readonly Domain[] | undefined) =>
        (old ?? []).map((existing) =>
          existing.id === domain.id
            ? { ...existing, isPaused: true, pausedReason: reason }
            : existing,
        ),
      );
      toast.success("Domain paused");
      await client.invalidateQueries({ queryKey: domains });
    },
    onError: (error: Error) => {
      toast.error("Failed to pause domain", { description: error.message });
    },
  });

  const { mutateAsync: unpauseDomain, isPending: isUnpausing } = useMutation({
    mutationFn: async () => await dashboard((client) => client.domains.unpause({ params })),
    onSuccess: async (_, __, ___, { client }) => {
      setOpen(false);
      client.setQueryData(domains, (old: readonly Domain[] | undefined) =>
        (old ?? []).map((existing) =>
          existing.id === domain.id
            ? { ...existing, isPaused: false, pausedReason: null }
            : existing,
        ),
      );
      toast.success("Domain unpaused");
      await client.invalidateQueries({ queryKey: domains });
    },
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
      await pauseDomain(value);
      form.reset();
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
              queued from it fail. Nothing is held to send later. It stays paused until someone
              unpauses it.
            </DialogDescription>
          </DialogHeader>
          <DialogPanel>
            <FieldGroup>
              <form.AppField name="reason">
                {(field) => (
                  <field.SelectField
                    description="Shown on the Domain while it is paused."
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
            ? "This Domain was paused for its sending reputation. Unpause it only once what caused the bounces or complaints is fixed: sends from it are accepted and delivered again straight away."
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

export function DomainMenu({
  children,
  domain,
  onDeleted,
  render = <Button size="icon" variant="ghost" />,
  hideViewDetails = false,
}: {
  children: React.ReactNode;
  domain: Domain;
  onDeleted?: () => void;
  render?: ComponentProps<typeof MenuTrigger>["render"];
  hideViewDetails?: boolean;
}) {
  const navigate = useNavigate();
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pauseOpen, setPauseOpen] = useState(false);
  const canPause = useCanPauseDomain({ domain });

  const { mutate: refreshDomain, isPending: isRefreshingDomain } = useRefreshDomain({ domain });

  const { mutate: deleteDomain, isPending: isDeletingDomain } = useDeleteDomain({
    domain,
    onDeleted,
  });

  return (
    <>
      <Menu>
        <MenuTrigger render={render}>{children}</MenuTrigger>
        <MenuPopup align="end" sideOffset={4}>
          {!hideViewDetails && (
            <MenuItem
              onClick={() =>
                navigate({
                  to: "/$orgSlug/domains/$fqdn",
                  params: { orgSlug, fqdn: domain.fqdn },
                })
              }
            >
              <RiEyeLine /> View Details
            </MenuItem>
          )}
          <MenuItem disabled={isRefreshingDomain} onClick={() => refreshDomain()}>
            <RiRefreshLine />
            Refresh
          </MenuItem>
          {canPause && (
            <MenuItem onClick={() => setPauseOpen(true)}>
              {domain.isPaused ? <RiPlayCircleLine /> : <RiPauseCircleLine />}
              {domain.isPaused ? "Unpause Domain" : "Pause Domain"}
            </MenuItem>
          )}
          <MenuItem
            className="text-destructive transition-colors data-highlighted:bg-destructive/10 data-highlighted:text-destructive"
            onClick={() => setDeleteOpen(true)}
          >
            <RiDeleteBin6Line />
            Delete Domain
          </MenuItem>
        </MenuPopup>
      </Menu>
      <ConfirmAction
        execute={() => deleteDomain()}
        isLoading={isDeletingDomain}
        open={deleteOpen}
        setOpen={setDeleteOpen}
        verificationText={domain.fqdn}
      />
      <DomainPause domain={domain} open={pauseOpen} setOpen={setPauseOpen} />
    </>
  );
}
