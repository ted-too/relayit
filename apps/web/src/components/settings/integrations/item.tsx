import {
  RiDeleteBin6Line,
  RiEditLine,
  RiMoreFill,
  RiStarLine,
} from "@remixicon/react";
import { Badge } from "@repo/ui/components/reui/badge";
import { Button } from "@repo/ui/components/ui/coss/button";
import {
  Menu,
  MenuItem,
  MenuPopup,
  MenuTrigger,
} from "@repo/ui/components/ui/coss/menu";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemTitle,
} from "@repo/ui/components/ui/shad/item";
import { formatDateTime } from "@repo/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/confirm-action";
import {
  deletePlatformProviderFn,
  setDefaultPlatformProviderFn,
} from "@/lib/admin/provider.functions";
import type { PlatformProviderListItem } from "@/lib/admin/providers";
import { queries } from "@/lib/queries";
import { PROVIDER_ICONS } from "./icons";
import { UpsertProvider } from "./upsert";

export function ProviderItem({
  provider,
}: {
  provider: PlatformProviderListItem;
}) {
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const productKey =
    `${provider.vendorId}.${provider.productId}` as keyof typeof PROVIDER_ICONS;
  const Icon = PROVIDER_ICONS[productKey];

  const { mutate: deleteProvider, isPending: isDeletingProvider } = useMutation(
    {
      mutationFn: async () =>
        await deletePlatformProviderFn({
          data: { providerId: provider.id },
        }),
      onSuccess: (_, __, ___, { client }) => {
        client.setQueryData(
          queries.admin.listProviders.queryKey,
          (old: PlatformProviderListItem[] | undefined) =>
            (old ?? []).filter(
              (existingProvider) => existingProvider.id !== provider.id
            )
        );
        client.invalidateQueries({
          queryKey: queries.admin.listProviders.queryKey,
        });
      },
      onError: (error: Error) => {
        toast.error("Failed to delete provider", {
          description: error.message,
        });
      },
    }
  );

  const { mutate: setDefault, isPending: isSettingDefault } = useMutation({
    mutationFn: async () =>
      await setDefaultPlatformProviderFn({
        data: { providerId: provider.id },
      }),
    onSuccess: async (_, __, ___, { client }) => {
      await client.invalidateQueries({
        queryKey: queries.admin.listProviders.queryKey,
      });
      toast.success("Default managed backend updated");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to set default");
    },
  });

  return (
    <Item
      className="rounded-none border-t-0 border-r-0 border-l-0 bg-background px-4 py-3 last:border-b-0"
      variant="outline"
    >
      <div className="mr-2 flex size-8 items-center justify-center">
        {Icon ? <Icon /> : null}
      </div>
      <ItemContent>
        <ItemTitle className="font-medium text-sm">
          {provider.name ?? "<no name>"}
          {provider.isDefault && (
            <Badge size="sm" variant="info-light">
              default
            </Badge>
          )}
          <Badge size="sm" variant="secondary">
            {provider.scope}
          </Badge>
        </ItemTitle>
        <ItemDescription>{formatDateTime(provider.createdAt)}</ItemDescription>
      </ItemContent>
      <ItemActions className="gap-3">
        <Badge variant="info-light">{productKey}</Badge>
        <Menu>
          <MenuTrigger render={<Button size="icon" variant="ghost" />}>
            <RiMoreFill />
          </MenuTrigger>
          <MenuPopup align="end" sideOffset={4}>
            <MenuItem onClick={() => setEditOpen(true)}>
              <RiEditLine /> Edit Provider
            </MenuItem>
            {!provider.isDefault && (
              <MenuItem
                disabled={isSettingDefault}
                onClick={() => setDefault()}
              >
                <RiStarLine /> Set as default
              </MenuItem>
            )}
            <MenuItem
              className="text-destructive transition-colors data-highlighted:bg-destructive/10 data-highlighted:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <RiDeleteBin6Line />
              Delete Provider
            </MenuItem>
          </MenuPopup>
        </Menu>
        <UpsertProvider
          initialData={provider}
          open={editOpen}
          setOpen={setEditOpen}
        />
        <ConfirmAction
          execute={() => deleteProvider()}
          isLoading={isDeletingProvider}
          open={deleteOpen}
          setOpen={setDeleteOpen}
          verificationText={
            provider.name && provider.name !== "" ? provider.name : productKey
          }
        />
      </ItemActions>
    </Item>
  );
}
