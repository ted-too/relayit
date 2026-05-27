import { RiSortDesc } from "@remixicon/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Button } from "@/components/resources/button";
import { Search } from "@/components/resources/search";
import { Select } from "@/components/resources/select";
import { Toolbar } from "@/components/resources/toolbar";
import { ApiKeyItem } from "@/components/settings/api-keys/item";
import { UpsertApiKey } from "@/components/settings/api-keys/upsert";
import { queries } from "@/integrations/queries";

export const Route = createFileRoute("/_authd/$orgSlug/settings/api-keys")({
  loader: ({ context, params }) => {
    void context.queryClient.ensureQueryData(
      queries.session.me.organizations.bySlug(params.orgSlug)
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
    SORT_OPTIONS[0]
  );
  const { data: rawApiKeys } = useSuspenseQuery(
    queries.session.me.organizations.bySlug(orgSlug).listApiKeys
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
        <UpsertApiKey render={<Button />}>Create API Key</UpsertApiKey>
      </Toolbar>
      {apiKeys.length > 0 ? (
        <div className="flex flex-col overflow-hidden rounded-lg border bg-background">
          {apiKeys.map((apiKey) => (
            <ApiKeyItem apiKey={apiKey} key={apiKey.id} />
          ))}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center gap-1 p-6 text-lg text-muted-foreground">
          No API keys found
          {search ? (
            <span className="font-light text-sm">for "{search}"</span>
          ) : (
            <p className="font-light text-sm">
              once you create one they will appear here
            </p>
          )}
        </div>
      )}
    </div>
  );
}
