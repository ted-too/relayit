import { createFileRoute } from "@tanstack/react-router";
import { DocsShell } from "@/components/docs-shell";
import {
  MarkdownArticle,
  TableOfContents,
} from "@/components/markdown-article";
import { getPage } from "@/lib/content.functions";
import { legalNav } from "@/lib/docs-nav";
import { site } from "@/lib/site";

const legalGroups = [{ items: legalNav, title: "Legal" }];

export const Route = createFileRoute("/legal/$")({
  loader: ({ params }) =>
    getPage({ data: { collection: "legal", slug: params._splat ?? "" } }),
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.title} | ${site.name}` },
          { content: loaderData.description, name: "description" },
        ]
      : [],
  }),
  component: LegalPage,
});

function LegalPage() {
  const page = Route.useLoaderData();
  return (
    <DocsShell groups={legalGroups} to="/legal/$">
      <MarkdownArticle page={page} />
      <TableOfContents page={page} />
    </DocsShell>
  );
}
