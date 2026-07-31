import { RiMoreFill } from "@remixicon/react";
import { Badge, type BadgeVariant } from "@repo/ui/components/reui/badge";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemMedia,
  ItemTitle,
} from "@repo/ui/components/ui/shad/item";
import { formatDateTime } from "@repo/ui/lib/utils";
import { Link, useParams } from "@tanstack/react-router";
import { DomainMenu } from "./domain-actions";
import { DOMAIN_PROVIDER_ICONS } from "./provider-icons";
import type { Domain } from "./types";

export const VERIFICATION_STATUS = {
  verified: { label: "Verified", variant: "success-light" },
  partially_verified: { label: "Partially verified", variant: "warning-light" },
  not_verified: { label: "Not verified", variant: "destructive-light" },
} as const satisfies Record<string, { label: string; variant: BadgeVariant }>;

export function DomainItem({ domain }: { domain: Domain }) {
  const { orgSlug } = useParams({ from: "/_authd/$orgSlug" });
  const verification =
    VERIFICATION_STATUS[domain.verificationStatus] ??
    VERIFICATION_STATUS.not_verified;

  const ProviderIcon = DOMAIN_PROVIDER_ICONS[domain.provider];

  return (
    <Item
      className="rounded-none border-t-0 border-r-0 border-l-0 bg-background px-4 py-3 last:border-b-0"
      render={
        <Link
          params={{ orgSlug, fqdn: domain.fqdn }}
          to="/$orgSlug/domains/$fqdn"
        />
      }
      variant="outline"
    >
      <ItemMedia variant="icon">
        <ProviderIcon />
      </ItemMedia>
      <ItemContent>
        <ItemTitle className="font-medium text-sm">
          {domain.fqdn}
          {domain.ownership.status !== "active" && (
            <Badge size="sm" variant="warning-light">
              claim pending
            </Badge>
          )}
          {domain.isPaused && (
            <Badge size="sm" variant="destructive-light">
              paused
            </Badge>
          )}
        </ItemTitle>
      </ItemContent>
      <ItemActions className="gap-3">
        <Badge size="sm" variant={verification.variant}>
          {verification.label}
        </Badge>
        <span className="tabular-nums">{formatDateTime(domain.createdAt)}</span>
        <DomainMenu domain={domain}>
          <RiMoreFill />
        </DomainMenu>
      </ItemActions>
    </Item>
  );
}
