import { createFileRoute } from "@tanstack/react-router";
import { DocsShell } from "@/components/docs-shell";
import {
  MarkdownArticle,
  TableOfContents,
} from "@/components/markdown-article";
import { getPage } from "@/lib/content.functions";
import { docsNav } from "@/lib/docs-nav";
import { site } from "@/lib/site";

export const Route = createFileRoute("/docs/$")({
  loader: ({ params }) =>
    getPage({ data: { collection: "docs", slug: params._splat ?? "" } }),
  head: ({ loaderData }) => ({
    meta: loaderData
      ? [
          { title: `${loaderData.title} | ${site.name} Docs` },
          { content: loaderData.description, name: "description" },
        ]
      : [],
  }),
  component: DocsPage,
});

function DocsPage() {
  const page = Route.useLoaderData();
  return (
    <DocsShell groups={docsNav} to="/docs/$">
      <MarkdownArticle page={page} />
      <TableOfContents page={page} />
    </DocsShell>
  );
}
