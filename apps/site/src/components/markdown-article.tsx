import { useEffect, useRef } from "react";
import type { RenderedPage } from "@/lib/content.server";

const COPIED_MS = 1600;

/** Copy buttons live in server-rendered HTML; one delegated handler serves all. */
const handleCopy = (event: MouseEvent) => {
  const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
    "[data-copy]"
  );
  const code = button?.closest("[data-code-block]")?.querySelector("pre");
  if (!(button && code)) {
    return;
  }
  navigator.clipboard.writeText(code.textContent ?? "").then(() => {
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy";
    }, COPIED_MS);
  });
};

export function MarkdownArticle({ page }: { page: RenderedPage }) {
  const body = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = body.current;
    element?.addEventListener("click", handleCopy);
    return () => element?.removeEventListener("click", handleCopy);
  }, []);

  return (
    <article className="min-w-0">
      <header className="border-b pb-8">
        <h1 className="font-semibold text-3xl tracking-tight md:text-4xl">
          {page.title}
        </h1>
        {page.description && (
          <p className="mt-3 max-w-[65ch] text-lg text-muted-foreground leading-relaxed">
            {page.description}
          </p>
        )}
      </header>
      <div
        className="typeset typeset-docs max-w-[72ch]"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: rendered from repo-owned markdown
        dangerouslySetInnerHTML={{ __html: page.html }}
        ref={body}
      />
    </article>
  );
}

export function TableOfContents({ page }: { page: RenderedPage }) {
  if (page.toc.length < 2) {
    return null;
  }
  return (
    <nav
      aria-label="On this page"
      className="sticky top-24 hidden flex-col gap-2 text-sm xl:flex"
    >
      <p className="font-medium">On this page</p>
      {page.toc.map((item) => (
        <a
          className="text-muted-foreground transition-colors hover:text-foreground data-[depth=3]:pl-3"
          data-depth={item.depth}
          href={`#${item.id}`}
          key={item.id}
        >
          {item.text}
        </a>
      ))}
    </nav>
  );
}
