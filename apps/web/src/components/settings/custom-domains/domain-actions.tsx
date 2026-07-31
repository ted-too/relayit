import { RiDeleteBin6Line, RiEyeLine, RiRefreshLine } from "@remixicon/react";
import { Button } from "@repo/ui/components/ui/coss/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@repo/ui/components/ui/coss/menu";
import { useMutation } from "@tanstack/react-query";
import {
  useNavigate,
  useParams,
  useRouteContext,
} from "@tanstack/react-router";
import { type ComponentProps, useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/confirm-action";
import {
  type ApiClient,
  formatToastError,
  type InferData,
  type InferError,
} from "@/integrations/api";
import { queries } from "@/integrations/queries";
import type { Domain } from "./types";

type DomainsGet = ReturnType<
  ApiClient["projects"]
>["channels"]["email"]["domains"]["get"];
type DomainById = ReturnType<
  ReturnType<ApiClient["projects"]>["channels"]["email"]["domains"]
>;

export function useRefreshDomain({ domain }: { domain: Domain }) {
  const { api } = useRouteContext({ from: "__root__" });
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });

  return useMutation({
    mutationFn: async () => {
      const { data, error } = await api
        .projects({ orgSlug })
        .channels.email.domains({ domainId: domain.id })
        .verify.post();

      if (error) {
        return Promise.reject(error);
      }

      return data;
    },
    onSuccess: async (data, _, __, { client }) => {
      client.setQueryData(
        queries.organizations.bySlug(orgSlug).listDomains.queryKey,
        (old: InferData<DomainsGet>) =>
          old.map((existingDomain) =>
            existingDomain.id === data.id ? data : existingDomain
          )
      );
      await client.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).listDomains.queryKey,
      });
      toast.success("Domain verification refreshed");
    },
    onError: (error: InferError<DomainById["verify"]["post"]>) => {
      toast.error(...formatToastError(error));
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
  const { api } = useRouteContext({ from: "__root__" });
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });

  return useMutation({
    mutationFn: async () => {
      const { error } = await api
        .projects({ orgSlug })
        .channels.email.domains({ domainId: domain.id })
        .delete();

      if (error) {
        return Promise.reject(error);
      }
    },
    onSuccess: (_, __, ___, { client }) => {
      onDeleted?.();
      client.setQueryData(
        queries.organizations.bySlug(orgSlug).listDomains.queryKey,
        (old: InferData<DomainsGet>) =>
          old.filter((existingDomain) => existingDomain.id !== domain.id)
      );
      client.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).listDomains.queryKey,
      });
    },
    onError: (error) => {
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
