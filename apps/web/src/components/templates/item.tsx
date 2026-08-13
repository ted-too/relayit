import { RiArrowRightSLine, RiMoreFill } from "@remixicon/react";
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
import { Link, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { ConfirmAction } from "@/components/confirm-action";
import { queries } from "@/lib/queries";
import type { TemplateListItem } from "@/lib/templating/catalog";
import { archiveTemplateFn } from "@/lib/templating/template.functions";
import type { Template } from "./types";

export function TemplateItem({ template }: { template: Template }) {
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const [archiveOpen, setArchiveOpen] = useState(false);

  const emailVariant = template.channelVariants.find(
    (variant) => variant.channel === "email"
  );

  const { mutate: archiveTemplate, isPending: isArchiving } = useMutation({
    mutationFn: async () =>
      await archiveTemplateFn({
        data: { orgSlug, templateId: template.id },
      }),
    onSuccess: async (data, _, __, { client }) => {
      client.setQueryData(
        queries.organizations.bySlug(orgSlug).listTemplates.queryKey,
        (old: TemplateListItem[] | undefined) =>
          (old ?? []).map((row) =>
            row.id === data.id ? { ...row, ...data } : row
          )
      );
      await client.invalidateQueries({
        queryKey: queries.organizations.bySlug(orgSlug).listTemplates.queryKey,
      });
      toast.success("Template archived");
      setArchiveOpen(false);
    },
    onError: (error: Error) => {
      toast.error("Failed to archive Template", {
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
          <Link
            className="hover:underline"
            params={{ orgSlug, templateId: template.id }}
            to="/$orgSlug/automations/templates/$templateId"
          >
            {template.name}
          </Link>
          <Badge size="sm" variant="secondary">
            {template.slug}
          </Badge>
          {template.archivedAt ? (
            <Badge size="sm" variant="destructive">
              Archived
            </Badge>
          ) : null}
          {emailVariant?.broken ? (
            <Badge size="sm" variant="destructive">
              Broken link
            </Badge>
          ) : null}
        </ItemTitle>
        <ItemDescription>
          {formatDateTime(new Date(template.createdAt))}
        </ItemDescription>
      </ItemContent>
      <ItemActions className="gap-2">
        {emailVariant ? (
          <span className="font-light text-muted-foreground text-sm">
            React Email
          </span>
        ) : (
          <span className="font-light text-muted-foreground text-sm">
            No email channel
          </span>
        )}
        <Button
          render={
            <Link
              params={{ orgSlug, templateId: template.id }}
              to="/$orgSlug/automations/templates/$templateId"
            />
          }
          size="icon-sm"
          variant="ghost"
        >
          <RiArrowRightSLine />
        </Button>
        {template.archivedAt ? null : (
          <>
            <Menu>
              <MenuTrigger render={<Button size="icon-sm" variant="ghost" />}>
                <RiMoreFill />
              </MenuTrigger>
              <MenuPopup>
                <MenuItem
                  onClick={() => setArchiveOpen(true)}
                  variant="destructive"
                >
                  Archive
                </MenuItem>
              </MenuPopup>
            </Menu>
            <ConfirmAction
              description="Archived Templates cannot be used for new Messages or Campaign Sends."
              execute={() => archiveTemplate()}
              isLoading={isArchiving}
              open={archiveOpen}
              setOpen={setArchiveOpen}
              title="Archive this Template?"
            />
          </>
        )}
      </ItemActions>
    </Item>
  );
}
