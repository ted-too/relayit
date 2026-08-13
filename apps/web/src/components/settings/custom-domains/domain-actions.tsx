import { RiDeleteBin6Line, RiEyeLine, RiRefreshLine } from "@remixicon/react";
import { Button } from "@repo/ui/components/ui/coss/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@repo/ui/components/ui/coss/menu";
import { useMutation } from "@tanstack/react-query";
import { useNavigate, useParams } from "@tanstack/react-router";
import { type ComponentProps, useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/confirm-action";
import {
  deleteCustomDomainFn,
  refreshCustomDomainFn,
} from "@/lib/domains/custom-domain.functions";
import type { ProjectDomainListItem } from "@/lib/domains/list";
import { queries } from "@/lib/queries";
import type { Domain } from "./types";

export function useRefreshDomain({ domain }: { domain: Domain }) {
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });

  return useMutation({
    mutationFn: async () =>
      await refreshCustomDomainFn({
        data: {
          customDomainId: domain.id,
          orgSlug,
        },
      }),
    onSuccess: async (data, _, __, { client }) => {
      client.setQueryData(
        queries.organizations.bySlug(orgSlug).listDomains.queryKey,
        (old: ProjectDomainListItem[] | undefined) =>
          (old ?? []).map((existingDomain) =>
            existingDomain.id === data.id ? data : existingDomain
          )
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

export function useDeleteDomain({
  domain,
  onDeleted,
}: {
  domain: Domain;
  onDeleted?: () => void;
}) {
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });

  return useMutation({
    mutationFn: async () =>
      await deleteCustomDomainFn({
        data: {
          customDomainId: domain.id,
          orgSlug,
        },
      }),
    onSuccess: (_, __, ___, { client }) => {
      onDeleted?.();
      client.setQueryData(
        queries.organizations.bySlug(orgSlug).listDomains.queryKey,
        (old: ProjectDomainListItem[] | undefined) =>
          (old ?? []).filter(
            (existingDomain) => existingDomain.id !== domain.id
          )
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

  const { mutate: refreshDomain, isPending: isRefreshingDomain } =
    useRefreshDomain({ domain });

  const { mutate: deleteDomain, isPending: isDeletingDomain } = useDeleteDomain(
    { domain, onDeleted }
  );

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
          <MenuItem
            disabled={isRefreshingDomain}
            onClick={() => refreshDomain()}
          >
            <RiRefreshLine />
            Refresh
          </MenuItem>
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
    </>
  );
}
