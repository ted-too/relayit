import { RiDeleteBin6Line, RiEditLine, RiMoreFill } from "@remixicon/react";
import { Badge } from "@repo/ui/components/reui/badge";
import {
  Avatar,
  AvatarFallback,
  AvatarImage,
} from "@repo/ui/components/ui/coss/avatar";
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
import { formatDateTime, getInitials } from "@repo/ui/lib/utils";
import { useMutation } from "@tanstack/react-query";
import { useParams, useRouteContext } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/confirm-action";
import type { ApiClient, InferData } from "@/integrations/api";
import { queries } from "@/integrations/queries";
import { UpsertApiKey } from "./upsert";

type ApiKeysGet = ReturnType<ApiClient["projects"]>["apiKeys"]["get"];

export function ApiKeyItem({
  apiKey,
}: {
  apiKey: InferData<ApiKeysGet>[number];
}) {
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const { betterAuth } = useRouteContext({ from: "__root__" });
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const { mutate: deleteApiKey, isPending: isDeletingApiKey } = useMutation({
    mutationFn: async () => {
      const { error } = await betterAuth.apiKey.delete({
        keyId: apiKey.id,
        configId: "org-keys",
      });

      if (error) {
        return Promise.reject(error);
      }
    },
    onSuccess: (_, __, ___, { client }) => {
      client.setQueryData(
        queries.organizations.bySlug(orgSlug).listApiKeys.queryKey,
        (old: InferData<ApiKeysGet>) =>
          old.filter((key) => key.id !== apiKey.id)
      );
      client.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).listApiKeys.queryKey,
      });
    },
    onError: (error) => {
      toast.error("Failed to delete API key", {
        description: error.message,
      });
    },
  });

  return (
    <Item
      className="rounded-none border-t-0 border-r-0 border-l-0 bg-background px-4 py-3 last:border-b-0"
      variant="outline"
    >
      <ItemContent>
        <ItemTitle className="font-medium text-sm">
          {apiKey.name}
          <Badge size="sm" variant="secondary">
            ...{apiKey.end ?? apiKey.start}
          </Badge>
        </ItemTitle>
        <ItemDescription>{formatDateTime(apiKey.createdAt)}</ItemDescription>
      </ItemContent>
      <ItemActions className="gap-3">
        <span className="font-light text-sm">
          {apiKey.lastRequest
            ? `last used: ${formatDistanceToNow(apiKey.lastRequest, {
                addSuffix: true,
              })}`
            : "Never used"}
        </span>
        <Avatar className="h-6 w-6 rounded-full">
          <AvatarImage
            alt={apiKey.createdBy?.name ?? ""}
            src={apiKey.createdBy?.image ?? undefined}
          />
          <AvatarFallback>
            {getInitials(apiKey.createdBy?.name ?? "")}
          </AvatarFallback>
        </Avatar>
        <Menu>
          <MenuTrigger render={<Button size="icon" variant="ghost" />}>
            <RiMoreFill />
          </MenuTrigger>
          <MenuPopup align="end" sideOffset={4}>
            <MenuItem onClick={() => setEditOpen(true)}>
              <RiEditLine /> Edit Key
            </MenuItem>
            <MenuItem
              className="text-destructive transition-colors data-highlighted:bg-destructive/10 data-highlighted:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <RiDeleteBin6Line />
              Delete Key
            </MenuItem>
          </MenuPopup>
        </Menu>
        <UpsertApiKey
          initialData={apiKey}
          open={editOpen}
          setOpen={setEditOpen}
        />
        <ConfirmAction
          execute={() => deleteApiKey()}
          isLoading={isDeletingApiKey}
          open={deleteOpen}
          setOpen={setDeleteOpen}
          verificationText={apiKey.name ?? undefined}
        />
      </ItemActions>
    </Item>
  );
}
