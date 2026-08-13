import { RiSortDesc } from "@remixicon/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CardList } from "@/components/resources/card-list";
import { Button } from "@/components/resources/primitives/button";
import { Search } from "@/components/resources/primitives/search";
import { Select } from "@/components/resources/primitives/select";
import { Toolbar } from "@/components/resources/primitives/toolbar";
import { ApiKeyItem } from "@/components/settings/api-keys/item";
import { UpsertApiKey } from "@/components/settings/api-keys/upsert";
import { queries } from "@/lib/queries";

export const Route = createFileRoute("/_authd/$orgSlug/api-keys")({
  loader: ({ context, params }) => {
    void context.queryClient.ensureQueryData(
      queries.organizations.bySlug(params.orgSlug).listApiKeys
    );
  },
  component: RouteComponent,
});

const SORT_OPTIONS = [
  { label: "Date Created", value: "createdAt" },
  { label: "Last Used", value: "lastUsed" },
  { label: "Name", value: "name" },
];

function RouteComponent() {
  const { orgSlug } = Route.useParams();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<(typeof SORT_OPTIONS)[number] | null>(
    SORT_OPTIONS[0] ?? null
  );
  const { data: rawApiKeys } = useSuspenseQuery(
    queries.organizations.bySlug(orgSlug).listApiKeys
  );

  const apiKeys = rawApiKeys
    .filter((apiKey) =>
      apiKey.createdBy?.name.toLowerCase().includes(search.toLowerCase())
    )
    .sort((a, b) => {
      switch (sort?.value) {
        case "createdAt":
          return a.createdAt.getTime() - b.createdAt.getTime();
        case "lastUsed":
          return (
            (a.lastRequest?.getTime() ?? 0) - (b.lastRequest?.getTime() ?? 0)
          );
        case "name":
          return a.name?.localeCompare(b.name ?? "") ?? -1;
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
        <UpsertApiKey render={<Button />}>Create API Key</UpsertApiKey>
      </Toolbar>
      <CardList
        emptyContent="No API keys found"
        filters={{ search }}
        items={apiKeys}
      >
        {(apiKey) => <ApiKeyItem apiKey={apiKey} />}
      </CardList>
    </div>
  );
}
