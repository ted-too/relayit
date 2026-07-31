import { RiSortDesc } from "@remixicon/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CardList } from "@/components/resources/card-list";
import { Button } from "@/components/resources/primitives/button";
import { Search } from "@/components/resources/primitives/search";
import { Select } from "@/components/resources/primitives/select";
import { Toolbar } from "@/components/resources/primitives/toolbar";
import { ProviderItem } from "@/components/settings/integrations/item";
import { UpsertProvider } from "@/components/settings/integrations/upsert";
import { queries } from "@/integrations/queries";

export const Route = createFileRoute("/_authd/admin/settings/integrations")({
  loader: ({ context }) => {
    void context.queryClient.ensureQueryData(queries.admin.listProviders);
  },
  component: RouteComponent,
});

const SORT_OPTIONS = [
  { label: "Date Created", value: "createdAt" },
  { label: "Name", value: "name" },
];

function RouteComponent() {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<(typeof SORT_OPTIONS)[number] | null>(
    SORT_OPTIONS[0]
  );
  const { data: providers } = useSuspenseQuery(queries.admin.listProviders);

  return (
    <div className="flex flex-col gap-4">
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
        <UpsertProvider render={<Button />}>Create Provider</UpsertProvider>
      </Toolbar>
      <CardList
        emptyContent="No providers found"
        filters={search === "" ? undefined : { search }}
        items={providers}
      >
        {(provider) => <ProviderItem key={provider.id} provider={provider} />}
      </CardList>
    </div>
  );
}
