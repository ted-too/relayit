import { Marked, type Tokens } from "marked";
import { createHighlighter, type Highlighter } from "shiki";

export type Collection = "docs" | "legal";

export interface TocItem {
  readonly depth: 2 | 3;
  readonly id: string;
  readonly text: string;
}

export interface RenderedPage {
  readonly description: string;
  readonly html: string;
  readonly slug: string;
  readonly title: string;
  readonly toc: readonly TocItem[];
}

const sources = import.meta.glob<string>("/content/**/*.md", {
  eager: true,
  import: "default",
  query: "?raw",
});

const FRONTMATTER = /^---\n([\s\S]*?)\n---\n?/;
const FRONTMATTER_LINE = /^(\w+):\s*(.*)$/;
const QUOTED = /^"(.*)"$/;
const WHITESPACE = /\s/;
const EXTERNAL_HREF = /^https?:\/\//;
const MD_EXTENSION = /\.md$/;

const parseFrontmatter = (source: string) => {
  const match = source.match(FRONTMATTER);
  const data: Record<string, string> = {};
  for (const line of match?.[1]?.split("\n") ?? []) {
    const field = line.match(FRONTMATTER_LINE);
    if (field?.[1] && field[2] !== undefined) {
      data[field[1]] = field[2].trim().replace(QUOTED, "$1");
    }
  }
  return { body: match ? source.slice(match[0].length) : source, data };
};

const slugify = (text: string) =>
  text
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/&[a-z]+;/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

const LANGS = [
  "bash",
  "diff",
  "dotenv",
  "html",
  "http",
  "json",
  "jsx",
  "python",
  "shellscript",
  "ts",
  "tsx",
  "typescript",
  "javascript",
  "yaml",
] as const;

let highlighter: Promise<Highlighter> | undefined;
const getHighlighter = () => {
  highlighter ??= createHighlighter({
    langs: [...LANGS],
    themes: ["github-light", "github-dark-default"],
  });
  return highlighter;
};

/** Highlight a standalone snippet (landing page) with the docs themes. */
export const highlight = async (code: string, lang: string) => {
  const shiki = await getHighlighter();
  return shiki.codeToHtml(code, {
    defaultColor: false,
    lang,
    themes: { dark: "github-dark-default", light: "github-light" },
  });
};

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

const renderPage = async (
  slug: string,
  source: string
): Promise<RenderedPage> => {
  const { body, data } = parseFrontmatter(source);
  const shiki = await getHighlighter();
  const toc: TocItem[] = [];
  const seen = new Map<string, number>();

  const marked = new Marked({
    gfm: true,
    renderer: {
      code({ lang, text }: Tokens.Code) {
        const language = lang?.split(WHITESPACE)[0] || "text";
        const highlight = (target: string) =>
          shiki.codeToHtml(text, {
            defaultColor: false,
            lang: target,
            themes: { dark: "github-dark-default", light: "github-light" },
          });
        let highlighted: string;
        try {
          highlighted = highlight(language);
        } catch {
          highlighted = highlight("text");
        }
        return `<div class="code-block" data-code-block><div class="code-block-bar" data-slot="code-bar"><span>${escapeHtml(language)}</span><button type="button" data-copy>Copy</button></div>${highlighted}</div>`;
      },
      heading({ depth, tokens }: Tokens.Heading) {
        const inner = this.parser.parseInline(tokens);
        if (depth !== 2 && depth !== 3) {
          return `<h${depth}>${inner}</h${depth}>`;
        }
        const base = slugify(inner) || "section";
        const count = seen.get(base) ?? 0;
        seen.set(base, count + 1);
        const id = count === 0 ? base : `${base}-${count}`;
        toc.push({ depth, id, text: inner.replace(/<[^>]+>/g, "") });
        return `<h${depth} id="${id}"><a class="heading-anchor" href="#${id}">${inner}</a></h${depth}>`;
      },
      link({ href, title, tokens }: Tokens.Link) {
        const inner = this.parser.parseInline(tokens);
        const external = EXTERNAL_HREF.test(href);
        const attrs = [
          `href="${escapeHtml(href)}"`,
          title ? `title="${escapeHtml(title)}"` : "",
          external ? 'target="_blank" rel="noreferrer"' : "",
        ]
          .filter(Boolean)
          .join(" ");
        return `<a ${attrs}>${inner}</a>`;
      },
      table(token: Tokens.Table) {
        const header = token.header
          .map((cell) => `<th>${this.parser.parseInline(cell.tokens)}</th>`)
          .join("");
        const rows = token.rows
          .map(
            (row) =>
              `<tr>${row.map((cell) => `<td>${this.parser.parseInline(cell.tokens)}</td>`).join("")}</tr>`
          )
          .join("");
        return `<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
      },
    },
  });

  const html = await marked.parse(body);
  return {
    description: data.description ?? "",
    html,
    slug,
    title: data.title ?? slug,
    toc,
  };
};

const cache = new Map<string, Promise<RenderedPage>>();

/** Index pages live at `<collection>/index.md` and resolve from slug "". */
export const loadPage = (collection: Collection, slug: string) => {
  const normalized = slug.replace(/^\/+|\/+$/g, "") || "index";
  const key = `/content/${collection}/${normalized}.md`;
  const source = sources[key];
  if (source === undefined) {
    return null;
  }
  let page = cache.get(key);
  if (!page || import.meta.env.DEV) {
    page = renderPage(normalized, source);
    cache.set(key, page);
  }
  return page;
};

export const listPages = (collection: Collection) =>
  Object.entries(sources)
    .filter(([path]) => path.startsWith(`/content/${collection}/`))
    .map(([path, source]) => {
      const { data } = parseFrontmatter(source);
      const slug = path
        .slice(`/content/${collection}/`.length)
        .replace(MD_EXTENSION, "");
      return {
        description: data.description ?? "",
        slug: slug === "index" ? "" : slug,
        title: data.title ?? slug,
      };
    });
