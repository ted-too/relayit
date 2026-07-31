import {
  RiCheckboxCircleFill,
  RiCloseCircleFill,
  RiDeleteBin6Line,
  RiErrorWarningFill,
  RiRefreshLine,
} from "@remixicon/react";
import { Badge } from "@repo/ui/components/reui/badge";
import { Button } from "@repo/ui/components/ui/coss/button";
import { formatDateTime } from "@repo/ui/lib/utils";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";
import { ConfirmAction } from "@/components/confirm-action";
import { DNSRecordsTable } from "@/components/settings/custom-domains/dns-records-table";
import {
  useDeleteDomain,
  useRefreshDomain,
} from "@/components/settings/custom-domains/domain-actions";
import { VERIFICATION_STATUS } from "@/components/settings/custom-domains/item";
import { DOMAIN_PROVIDER_ICONS } from "@/components/settings/custom-domains/provider-icons";
import { queries } from "@/integrations/queries";

export const Route = createFileRoute("/_authd/$orgSlug/domains/$fqdn")({
  loader: async ({ context, params }) => {
    const domains = await context.queryClient.ensureQueryData(
      queries.organizations.bySlug(params.orgSlug).listDomains
    );

    const domain = domains.find((domain) => domain.fqdn === params.fqdn);

    if (!domain) {
      throw notFound();
    }
  },
  component: RouteComponent,
});

function RouteComponent() {
  const navigate = useNavigate();
  const { orgSlug, fqdn } = Route.useParams();
  const { data: domain } = useSuspenseQuery({
    ...queries.organizations.bySlug(orgSlug).listDomains,
    // biome-ignore lint/style/noNonNullAssertion: we are guaranteed to find the domain
    select: (domains) => domains.find((domain) => domain.fqdn === fqdn)!,
  });
  const [deleteOpen, setDeleteOpen] = useState(false);
  const { mutate: deleteDomain, isPending: isDeletingDomain } = useDeleteDomain(
    {
      domain,
      onDeleted: () =>
        navigate({
          to: "/$orgSlug/domains",
          params: { orgSlug },
        }),
    }
  );
  const { mutate: refreshDNSRecords, isPending: isRefreshingDNSRecords } =
    useRefreshDomain({ domain });

  const canSend = domain.verificationStatus === "verified" && !domain.isPaused;

  const ProviderIcon = DOMAIN_PROVIDER_ICONS[domain.provider];

  return (
    <div className="w-full">
      <div className="flex w-full flex-col gap-6 border-y bg-card p-6">
        <div className="flex w-full items-center justify-between">
          <span className="font-medium text-3xl">{domain.fqdn}</span>
          <Button
            onClick={() => setDeleteOpen(true)}
            size="icon-lg"
            variant="destructive-light"
          >
            <RiDeleteBin6Line />
          </Button>
          <ConfirmAction
            execute={() => deleteDomain()}
            isLoading={isDeletingDomain}
            open={deleteOpen}
            setOpen={setDeleteOpen}
            verificationText={domain.fqdn}
          />
        </div>
        <div className="grid grid-cols-5 gap-6">
          {(
            [
              {
                label: "Provider",
                children: (
                  <div className="flex items-center gap-2">
                    <ProviderIcon className="size-5" />
                    <span className="capitalize">{domain.provider}</span>
                  </div>
                ),
              },
              {
                label: "Status",
                children: (
                  <Badge
                    variant={
                      VERIFICATION_STATUS[domain.verificationStatus].variant
                    }
                  >
                    {VERIFICATION_STATUS[domain.verificationStatus].label}
                  </Badge>
                ),
              },
              {
                label: "Can Send",
                children: (
                  <div className="flex items-center gap-2">
                    {canSend ? (
                      <RiCheckboxCircleFill className="size-5 text-success-foreground" />
                      // biome-ignore lint/style/noNestedTernary: this is the cleanest way to do this
                    ) : domain.isPaused ? (
                      <RiCloseCircleFill className="size-5 text-destructive-foreground" />
                    ) : (
                      <RiErrorWarningFill className="size-5 text-warning-foreground" />
                    )}
                    <span>{canSend ? "Yes" : "No"}</span>
                  </div>
                ),
              },
              {
                label: "Last Checked",
                children: (
                  <span>
                    {domain.lastCheckedAt
                      ? formatDistanceToNow(domain.lastCheckedAt, {
                          addSuffix: true,
                        })
                      : "Never"}
                  </span>
                ),
              },
              {
                label: "Created",
                children: <span>{formatDateTime(domain.createdAt)}</span>,
              },
            ] satisfies { label: string; children: React.ReactNode }[]
          ).map(({ label, children }, index) => (
            <div
              className="flex flex-col gap-2 text-sm"
              key={`metadata-${index}`}
            >
              <span>{label}</span>
              {children}
            </div>
          ))}
        </div>
      </div>
      <div className="my-10 flex w-full flex-col gap-6 px-6">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-2">
            <span className="font-semibold text-xl">DNS Records</span>
            <p className="text-muted-foreground text-sm">
              DNS records are used to verify ownership of the domain and to
              ensure that the domain is correctly configured.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <Button
              isLoading={isRefreshingDNSRecords}
              onClick={() => refreshDNSRecords()}
              size="sm"
              variant="outline"
            >
              <RiRefreshLine />
              Refresh
            </Button>
          </div>
        </div>
        {domain.dnsRecords.ownership.length > 0 && (
          <DNSRecordsTable
            fqdn={domain.fqdn}
            records={domain.dnsRecords.ownership}
            title="Ownership"
          />
        )}
        <DNSRecordsTable
          fqdn={domain.fqdn}
          hasPriority
          records={domain.dnsRecords.dkimAndSpf}
          title="DKIM and SPF"
        />
        <DNSRecordsTable
          fqdn={domain.fqdn}
          optional
          records={domain.dnsRecords.dmarc}
          title="DMARC"
        />
      </div>
    </div>
  );
}
