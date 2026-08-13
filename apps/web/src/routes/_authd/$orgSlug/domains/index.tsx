import { RiSortDesc } from "@remixicon/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CardList } from "@/components/resources/card-list";
import { Button } from "@/components/resources/primitives/button";
import { Search } from "@/components/resources/primitives/search";
import { Select } from "@/components/resources/primitives/select";
import { Toolbar } from "@/components/resources/primitives/toolbar";
import { CreateDomain } from "@/components/settings/custom-domains/create";
import { DomainItem } from "@/components/settings/custom-domains/item";
import { queries } from "@/lib/queries";

export const Route = createFileRoute("/_authd/$orgSlug/domains/")({
  loader: ({ context, params }) => {
    void context.queryClient.ensureQueryData(
      queries.organizations.bySlug(params.orgSlug).listDomains
    );
  },
  component: RouteComponent,
});

const SORT_OPTIONS = [
  { label: "Date Created", value: "createdAt" },
  { label: "Verification Status", value: "verificationStatus" },
  { label: "Domain Name", value: "fqdn" },
];

function RouteComponent() {
  const { orgSlug } = Route.useParams();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<(typeof SORT_OPTIONS)[number] | null>(
    SORT_OPTIONS[0] ?? null
  );
  const { data: rawDomains } = useSuspenseQuery(
    queries.organizations.bySlug(orgSlug).listDomains
  );

  const domains = rawDomains
    .filter((domain) =>
      domain.fqdn.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      switch (sort?.value) {
        case "createdAt":
          return a.createdAt.getTime() - b.createdAt.getTime();
        case "verificationStatus":
          return a.verificationStatus.localeCompare(b.verificationStatus);
        case "fqdn":
          return a.fqdn.localeCompare(b.fqdn);
        default:
          return 0;
      }
    });

  return (
    <div className="flex flex-col gap-4" data-slot="balanced-outlet">
      <Toolbar>
        <Search onChange={setSearch} value={search} />
        <Select
          className="min-w-38"
          items={SORT_OPTIONS}
          leftAddon={<RiSortDesc />}
          multiple={false}
          onChange={setSort}
          value={sort}
        />
        <CreateDomain render={<Button />}>Add Custom Domain</CreateDomain>
      </Toolbar>
      <CardList
        createCTAContent="once you add one it will appear here."
        emptyContent="No custom domains found"
        filters={{ search }}
        items={domains}
      >
        {(domain) => <DomainItem domain={domain} />}
      </CardList>
    </div>
  );
}
