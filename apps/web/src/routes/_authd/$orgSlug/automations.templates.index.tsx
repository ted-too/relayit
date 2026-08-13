import { RiSortDesc } from "@remixicon/react";
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { CardList } from "@/components/resources/card-list";
import { Button } from "@/components/resources/primitives/button";
import { Search } from "@/components/resources/primitives/search";
import { Select } from "@/components/resources/primitives/select";
import { Toolbar } from "@/components/resources/primitives/toolbar";
import { CreateTemplate } from "@/components/templates/create";
import { TemplateItem } from "@/components/templates/item";
import { queries } from "@/lib/queries";

export const Route = createFileRoute("/_authd/$orgSlug/automations/templates/")(
  {
    loader: ({ context, params }) => {
      void context.queryClient.ensureQueryData(
        queries.organizations.bySlug(params.orgSlug).listTemplates
      );
    },
    component: RouteComponent,
  }
);

const SORT_OPTIONS = [
  { label: "Date created", value: "createdAt" },
  { label: "Name", value: "name" },
] as const;

function RouteComponent() {
  const { orgSlug } = Route.useParams();
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<(typeof SORT_OPTIONS)[number] | null>(
    SORT_OPTIONS[0]
  );
  const { data: rawTemplates } = useSuspenseQuery(
    queries.organizations.bySlug(orgSlug).listTemplates
  );

  const templates = rawTemplates
    .filter(
      (template) =>
        !template.archivedAt &&
        (template.name.toLowerCase().includes(search.toLowerCase()) ||
          template.slug.toLowerCase().includes(search.toLowerCase()))
    )
    .sort((a, b) => {
      switch (sort?.value) {
        case "createdAt":
          return (
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
          );
        case "name":
          return a.name.localeCompare(b.name);
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
          items={[...SORT_OPTIONS]}
          leftAddon={<RiSortDesc />}
          multiple={false}
          onChange={setSort}
          value={sort}
        />
        <CreateTemplate render={<Button />}>Create Template</CreateTemplate>
      </Toolbar>
      <CardList
        emptyContent="No Templates yet. Create one to start authoring React Email."
        filters={{ search }}
        items={templates}
      >
        {(template) => <TemplateItem key={template.id} template={template} />}
      </CardList>
    </div>
  );
}
