import { notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import {
  type Collection,
  highlight,
  listPages,
  loadPage,
} from "@/lib/content.server";
import { landingSnippets } from "@/lib/snippets";

interface PageRequest {
  readonly collection: Collection;
  readonly slug: string;
}

export const getPage = createServerFn({ method: "GET" })
  .validator((input: PageRequest) => input)
  .handler(async ({ data }) => {
    const page = await loadPage(data.collection, data.slug);
    if (!page) {
      throw notFound();
    }
    return page;
  });

export const getPageList = createServerFn({ method: "GET" })
  .validator((collection: Collection) => collection)
  .handler(({ data }) => listPages(data));

/** Landing snippets are static, so highlighting happens once per server. */
let landingCode: Promise<Record<string, string>> | undefined;

export const getLandingCode = createServerFn({ method: "GET" }).handler(() => {
  landingCode ??= Promise.all(
    landingSnippets.map(
      async (snippet) =>
        [snippet.id, await highlight(snippet.code, snippet.lang)] as const
    )
  ).then(Object.fromEntries);
  return landingCode;
});
